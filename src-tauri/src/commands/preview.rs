use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use image::GenericImageView;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use tokio::process::{Child, Command};
use tokio::time::{sleep, Instant};
use uuid::Uuid;

use crate::app_log::LogLevel;
use crate::binaries::{resolve_binary, FFMPEG, YTDLP};
use crate::chat_overlay::render_chat_json_file;
use crate::commands::resolve::{detect_platform, resolve_direct_url};
use crate::hls_proxy;
use crate::jobs::types::{BlurZone, ChatOverlaySettings, PerformanceSettings};
use crate::proxy::ProxyConfig;
use crate::AppState;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewSource {
    pub id: Option<String>,
    pub url: String,
    pub input_url: String,
    pub platform: String,
    pub transport: String,
    pub mode: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CapturedFrame {
    pub path: String,
    pub url: String,
    pub time_sec: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatJsonRenderRequest {
    pub chat_json_path: String,
    pub output_directory: String,
    pub output_name: String,
    #[serde(default)]
    pub chat_overlay: ChatOverlaySettings,
    #[serde(default)]
    pub performance: PerformanceSettings,
    #[serde(default)]
    pub binaries_dir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatJsonRenderResult {
    pub output_path: String,
}

struct PreviewSession {
    child: Child,
    dir: PathBuf,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, PreviewSession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, PreviewSession>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_hls_url(url: &str) -> bool {
    url.to_lowercase()
        .split('?')
        .next()
        .unwrap_or_default()
        .contains(".m3u8")
}

fn is_rtmp_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("rtmp://")
        || lower.starts_with("rtmps://")
        || lower.starts_with("rtmpt://")
        || lower.starts_with("rtmpe://")
}

fn is_http_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn is_direct_http_media_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        _ => return false,
    };
    let path = parsed.path().to_lowercase();
    let query = parsed.query().unwrap_or_default().to_lowercase();
    is_hls_url(url)
        || [
            ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".flv", ".avi", ".ts", ".m2ts", ".mp3",
            ".m4a", ".aac", ".opus", ".ogg", ".wav",
        ]
        .iter()
        .any(|ext| path.ends_with(ext))
        || path.contains("/videoplayback")
        || query.contains("mime=video")
        || query.contains("mime=audio")
}

fn preview_referer(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    if lower.contains("twitch.tv")
        || lower.contains("ttvnw.net")
        || lower.contains("cloudfront.net")
    {
        Some("https://www.twitch.tv/".to_string())
    } else if lower.contains("kick.com") || lower.contains("kick.com/") {
        Some("https://kick.com/".to_string())
    } else {
        None
    }
}

fn classify_platform(input_url: &str, resolved_url: &str) -> String {
    let platform = detect_platform(input_url);
    if platform != "unknown" {
        return platform;
    }
    if is_rtmp_url(input_url) || is_rtmp_url(resolved_url) {
        "rtmp".to_string()
    } else if is_hls_url(resolved_url) {
        "hls".to_string()
    } else {
        "unknown".to_string()
    }
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[tauri::command]
pub async fn start_stream_preview(
    url: String,
    proxy: Option<ProxyConfig>,
    binaries_dir: Option<String>,
    quality: Option<String>,
) -> Result<PreviewSource, String> {
    let input_url = url.trim().to_string();
    if input_url.is_empty() {
        return Err("empty preview URL".to_string());
    }

    if is_hls_url(&input_url) {
        let proxied = hls_proxy::proxied_hls_url(input_url.clone(), preview_referer(&input_url))?;
        return Ok(PreviewSource {
            id: None,
            url: proxied,
            input_url,
            platform: "hls".to_string(),
            transport: "hls".to_string(),
            mode: "proxy".to_string(),
            message: Some("Direct HLS is routed through the local preview proxy.".to_string()),
        });
    }

    if is_rtmp_url(&input_url) {
        return start_ffmpeg_hls_preview(input_url, "rtmp".to_string(), binaries_dir).await;
    }

    let direct =
        resolve_direct_url(input_url.clone(), proxy, binaries_dir.clone(), quality).await?;
    let platform = classify_platform(&input_url, &direct);

    if is_hls_url(&direct) {
        let proxied = hls_proxy::proxied_hls_url(
            direct.clone(),
            preview_referer(&direct).or_else(|| preview_referer(&input_url)),
        )?;
        return Ok(PreviewSource {
            id: None,
            url: proxied,
            input_url: direct,
            platform,
            transport: "hls".to_string(),
            mode: "proxy".to_string(),
            message: Some("Resolved stream is playable as proxied HLS.".to_string()),
        });
    }

    if is_rtmp_url(&direct) {
        return start_ffmpeg_hls_preview(direct, platform, binaries_dir).await;
    }

    if is_http_url(&direct) {
        return Ok(PreviewSource {
            id: None,
            url: direct.clone(),
            input_url: direct,
            platform,
            transport: "http".to_string(),
            mode: "direct".to_string(),
            message: Some("Resolved stream is playable directly by the WebView.".to_string()),
        });
    }

    Err(format!(
        "Unsupported preview transport. yt-dlp returned: {}",
        direct
    ))
}

#[tauri::command]
pub async fn capture_preview_frame(
    state: State<'_, AppState>,
    url: String,
    time_sec: f64,
    output_width: Option<u32>,
    output_height: Option<u32>,
    quality: Option<String>,
    proxy: Option<ProxyConfig>,
    binaries_dir: Option<String>,
) -> Result<CapturedFrame, String> {
    let input_url = url.trim().to_string();
    if input_url.is_empty() {
        let msg = "empty preview URL".to_string();
        state.queue.emit_app_error(
            "chat_render_random_screenshot_failed",
            msg.clone(),
            None,
            None,
        );
        return Err(msg);
    }
    let log_input = json!({
        "stream": input_url,
        "time_sec": time_sec,
        "output_width": output_width,
        "output_height": output_height,
        "quality": quality,
        "proxy": proxy,
        "binaries_dir": binaries_dir,
    });
    state.queue.emit_app_log(
        LogLevel::Info,
        "chat_render_random_screenshot_started",
        "Started random stream frame capture",
        Some(log_input.clone()),
    );
    let bin_dir = binaries_dir.as_deref().map(Path::new);
    let ffmpeg = match resolve_binary(FFMPEG, bin_dir) {
        Some(path) => path,
        None => {
            let msg = "ffmpeg.exe not found; screenshot requires FFmpeg".to_string();
            state.queue.emit_app_error(
                "chat_render_random_screenshot_failed",
                msg.clone(),
                None,
                Some(log_input),
            );
            return Err(msg);
        }
    };
    let media_url = if is_hls_url(&input_url)
        || is_direct_http_media_url(&input_url)
        || is_rtmp_url(&input_url)
    {
        input_url.clone()
    } else {
        match resolve_direct_url_for_capture(
            &state,
            input_url.clone(),
            proxy.clone(),
            binaries_dir.clone(),
            quality.clone(),
            log_input.clone(),
        )
        .await
        {
            Ok(url) => url,
            Err(err) => {
                state.queue.emit_app_error(
                    "chat_render_random_screenshot_failed",
                    err.clone(),
                    None,
                    Some(log_input),
                );
                return Err(err);
            }
        }
    };

    let width = output_width.unwrap_or(1920).max(1);
    let height = output_height.unwrap_or(1080).max(1);
    let id = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join("fetchr-preview-frame");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create screenshot dir: {e}"))?;
    let path = dir.join(format!("{id}.png"));
    let filter = format!(
        "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    );

    let mut cmd = Command::new(ffmpeg);
    hide_console(&mut cmd);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error"]);
    if time_sec > 0.0 {
        cmd.args(["-ss", &format!("{time_sec:.3}")]);
    }
    cmd.args(["-i", &media_url, "-frames:v", "1", "-vf", &filter])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let command_line = format!(
        "ffmpeg -y -hide_banner -loglevel error{} -i {} -frames:v 1 -vf {} {}",
        if time_sec > 0.0 {
            format!(" -ss {time_sec:.3}")
        } else {
            String::new()
        },
        media_url,
        filter,
        path.display(),
    );
    state.queue.log_command_started(
        "system",
        command_line.clone(),
        Some(json!({
            "action": "chat_render_random_screenshot",
            "stream": input_url,
            "media_url": media_url,
            "time_sec": time_sec,
            "output_path": path.to_string_lossy(),
        })),
    );

    let output = match cmd.output().await {
        Ok(output) => output,
        Err(e) => {
            let msg = format!("capture screenshot: {e}");
            state.queue.emit_app_error(
                "chat_render_random_screenshot_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({
                    "stream": input_url,
                    "media_url": media_url,
                    "time_sec": time_sec,
                    "output_path": path.to_string_lossy(),
                })),
            );
            return Err(msg);
        }
    };
    let exit_code = output.status.code();
    state
        .queue
        .log_command_finished("system", command_line, exit_code);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !stderr.trim().is_empty() {
            state.queue.log_stderr("system", &stderr);
        }
        state.queue.emit_app_error(
            "chat_render_random_screenshot_failed",
            format!("ffmpeg screenshot failed: {stderr}"),
            None,
            Some(json!({
                "stream": input_url,
                "media_url": media_url,
                "time_sec": time_sec,
                "output_path": path.to_string_lossy(),
                "exit_code": exit_code,
                "stderr": stderr,
            })),
        );
        return Err(format!(
            "ffmpeg screenshot failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let url = tauri::Url::from_file_path(&path)
        .map_err(|_| format!("invalid screenshot path: {}", path.display()))?
        .to_string();
    let preview_url = png_data_url_from_path(&path).unwrap_or(url);
    state.queue.emit_app_log(
        LogLevel::Info,
        "chat_render_random_screenshot_finished",
        format!("Captured stream frame to {}", path.display()),
        Some(json!({
            "stream": input_url,
            "media_url": media_url,
            "time_sec": time_sec,
            "path": path.to_string_lossy(),
            "width": width,
            "height": height,
            "exit_code": exit_code,
        })),
    );
    Ok(CapturedFrame {
        path: path.to_string_lossy().to_string(),
        url: preview_url,
        time_sec,
        width,
        height,
    })
}

async fn resolve_direct_url_for_capture(
    state: &State<'_, AppState>,
    url: String,
    proxy: Option<ProxyConfig>,
    binaries_dir: Option<String>,
    quality: Option<String>,
    log_input: serde_json::Value,
) -> Result<String, String> {
    let bin_dir = binaries_dir.as_deref().map(Path::new);
    let ytdlp = resolve_binary(YTDLP, bin_dir).ok_or_else(|| {
        let msg =
            "yt-dlp.exe not found; screenshot requires yt-dlp to resolve page URLs".to_string();
        state.queue.emit_app_error(
            "chat_render_random_screenshot_resolve_failed",
            msg.clone(),
            None,
            Some(log_input.clone()),
        );
        msg
    })?;

    let preview_format = match quality.as_deref() {
        Some(q) if !q.is_empty() && q != "best" => {
            format!("{q}/best[protocol^=m3u8]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best")
        }
        _ => "best[protocol^=m3u8]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best".to_string(),
    };

    let proxy_arg = proxy.as_ref().and_then(|p| p.for_ytdlp());
    let mut cmd = Command::new(&ytdlp);
    configure_ytdlp_env(&mut cmd);
    hide_console(&mut cmd);
    cmd.arg("-g")
        .arg("--no-check-certificates")
        .arg("--no-warnings")
        .args(["-f", &preview_format]);
    if let Some(px) = proxy_arg.as_deref() {
        cmd.args(["--proxy", px]);
    }
    cmd.arg(&url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut display_args = vec![
        ytdlp.to_string_lossy().to_string(),
        "-g".to_string(),
        "--no-check-certificates".to_string(),
        "--no-warnings".to_string(),
        "-f".to_string(),
        preview_format,
    ];
    if let Some(px) = proxy_arg {
        display_args.push("--proxy".to_string());
        display_args.push(px);
    }
    display_args.push(url.clone());
    let command_line = display_args.join(" ");

    state.queue.log_command_started(
        "system",
        command_line.clone(),
        Some(json!({
            "action": "chat_render_random_screenshot_resolve",
            "stream": url,
            "quality": quality,
            "binaries_dir": binaries_dir,
        })),
    );

    let output = match cmd.output().await {
        Ok(output) => output,
        Err(e) => {
            let msg = format!("yt-dlp -g failed to start: {e}");
            state.queue.emit_app_error(
                "chat_render_random_screenshot_resolve_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(log_input),
            );
            return Err(msg);
        }
    };
    state
        .queue
        .log_command_finished("system", command_line, output.status.code());

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stdout.trim().is_empty() {
        state.queue.log_stdout("system", &stdout);
    }
    if !stderr.trim().is_empty() {
        state.queue.log_stderr("system", &stderr);
    }
    if !output.status.success() {
        let msg = format!("yt-dlp -g failed: {stderr}");
        state.queue.emit_app_error(
            "chat_render_random_screenshot_resolve_failed",
            msg.clone(),
            None,
            Some(json!({
                "stream": url,
                "exit_code": output.status.code(),
                "stdout": stdout,
                "stderr": stderr,
            })),
        );
        return Err(msg);
    }

    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find(|line| line.to_lowercase().contains(".m3u8"))
        .or_else(|| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .find(|line| is_direct_http_media_url(line))
        })
        .or_else(|| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .find(|line| is_http_url(line))
        })
        .map(str::to_string)
        .ok_or_else(|| {
            let msg = "yt-dlp -g did not return a playable media URL for screenshot".to_string();
            state.queue.emit_app_error(
                "chat_render_random_screenshot_resolve_failed",
                msg.clone(),
                None,
                Some(json!({
                    "stream": url,
                    "exit_code": output.status.code(),
                    "stdout": stdout,
                    "stderr": stderr,
                })),
            );
            msg
        })
}

fn configure_ytdlp_env(cmd: &mut Command) {
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONLEGACYWINDOWSSTDIO", "0");
}

#[tauri::command]
pub async fn validate_chat_render_screenshot_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<CapturedFrame, String> {
    let input_url = url.trim().to_string();
    let log_input = json!({ "screenshot_url": input_url });
    if input_url.is_empty() {
        let msg = "Вставьте ссылку на изображение.".to_string();
        state.queue.emit_app_error(
            "chat_render_screenshot_url_failed",
            msg.clone(),
            None,
            Some(log_input),
        );
        return Err(msg);
    }
    let parsed = match url::Url::parse(&input_url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        _ => {
            let msg = "Ссылка на скрин должна быть HTTP/HTTPS URL.".to_string();
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                None,
                Some(log_input),
            );
            return Err(msg);
        }
    };
    state.queue.emit_app_log(
        LogLevel::Info,
        "chat_render_screenshot_url_started",
        "Started screenshot URL validation",
        Some(json!({ "screenshot_url": parsed.as_str() })),
    );

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| {
            let msg = format!("Не удалось подготовить загрузку изображения: {e}");
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({ "screenshot_url": parsed.as_str() })),
            );
            msg
        })?;

    let resp = match client.get(parsed.clone()).send().await {
        Ok(resp) => resp,
        Err(e) => {
            let msg = if e.is_timeout() || e.is_connect() {
                "Не удалось скачать скрин: ошибка сети.".to_string()
            } else {
                format!("Не удалось скачать скрин: {e}")
            };
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({ "screenshot_url": parsed.as_str() })),
            );
            return Err(msg);
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let msg = format!("Не удалось скачать скрин: сервер вернул HTTP {status}.");
        state.queue.emit_app_error(
            "chat_render_screenshot_url_failed",
            msg.clone(),
            Some(format!("HTTP {status} for {}", parsed.as_str())),
            Some(json!({ "screenshot_url": parsed.as_str(), "status": status.as_u16() })),
        );
        return Err(msg);
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = match resp.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            let msg = format!("Не удалось прочитать файл скрина: {e}");
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({ "screenshot_url": parsed.as_str(), "content_type": content_type })),
            );
            return Err(msg);
        }
    };
    if bytes.len() > 30 * 1024 * 1024 {
        let msg = "Скрин слишком большой: максимум 30 MB.".to_string();
        state.queue.emit_app_error(
            "chat_render_screenshot_url_failed",
            msg.clone(),
            None,
            Some(json!({ "screenshot_url": parsed.as_str(), "bytes": bytes.len() })),
        );
        return Err(msg);
    }
    let guessed = match image::guess_format(&bytes) {
        Ok(format) => format,
        Err(e) => {
            let msg = "Ссылка не ведёт на валидную картинку.".to_string();
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({
                    "screenshot_url": parsed.as_str(),
                    "content_type": content_type,
                    "bytes": bytes.len(),
                })),
            );
            return Err(msg);
        }
    };
    let image = match image::load_from_memory(&bytes) {
        Ok(image) => image,
        Err(e) => {
            let msg = "Ссылка не ведёт на валидную картинку.".to_string();
            state.queue.emit_app_error(
                "chat_render_screenshot_url_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(json!({
                    "screenshot_url": parsed.as_str(),
                    "content_type": content_type,
                    "bytes": bytes.len(),
                })),
            );
            return Err(msg);
        }
    };
    let (width, height) = image.dimensions();
    let ext = match guessed {
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::Png => "png",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Bmp => "bmp",
        _ => "img",
    };
    let id = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join("fetchr-chat-render-screenshot");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        let msg = format!("Не удалось создать папку для скрина: {e}");
        state.queue.emit_app_error(
            "chat_render_screenshot_url_failed",
            msg.clone(),
            Some(format!("{e:?}")),
            Some(json!({ "screenshot_url": parsed.as_str() })),
        );
        return Err(msg);
    }
    let path = dir.join(format!("{id}.{ext}"));
    if let Err(e) = std::fs::write(&path, &bytes) {
        let msg = format!("Не удалось сохранить скрин: {e}");
        state.queue.emit_app_error(
            "chat_render_screenshot_url_failed",
            msg.clone(),
            Some(format!("{e:?}")),
            Some(json!({
                "screenshot_url": parsed.as_str(),
                "path": path.to_string_lossy(),
            })),
        );
        return Err(msg);
    }
    let file_url = tauri::Url::from_file_path(&path)
        .map_err(|_| format!("invalid screenshot path: {}", path.display()))?
        .to_string();
    let preview_url = image_data_url(&bytes, ext).unwrap_or(file_url);
    state.queue.emit_app_log(
        LogLevel::Info,
        "chat_render_screenshot_url_finished",
        format!("Validated screenshot URL and saved {}", path.display()),
        Some(json!({
            "screenshot_url": parsed.as_str(),
            "path": path.to_string_lossy(),
            "bytes": bytes.len(),
            "content_type": content_type,
            "width": width,
            "height": height,
            "format": format!("{guessed:?}"),
        })),
    );
    Ok(CapturedFrame {
        path: path.to_string_lossy().to_string(),
        url: preview_url,
        time_sec: 0.0,
        width,
        height,
    })
}

fn png_data_url_from_path(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    image_data_url(&bytes, "png")
}

fn image_data_url(bytes: &[u8], ext: &str) -> Option<String> {
    if bytes.len() > 10 * 1024 * 1024 {
        return None;
    }
    let mime = match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    };
    Some(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn chat_render_log_action(
    state: State<'_, AppState>,
    action: String,
    input: Option<serde_json::Value>,
) -> Result<(), String> {
    let action = action.trim();
    if action.is_empty() {
        return Ok(());
    }
    state.queue.emit_app_log(
        LogLevel::Info,
        &format!("chat_render_{action}"),
        "Chat render UI action",
        input,
    );
    Ok(())
}

#[tauri::command]
pub async fn render_chat_json(
    state: State<'_, AppState>,
    req: ChatJsonRenderRequest,
) -> Result<ChatJsonRenderResult, String> {
    let bin_dir = req.binaries_dir.as_deref().map(Path::new);
    let output = render_chat_json_file(
        &state.queue,
        Path::new(&req.chat_json_path),
        Path::new(&req.output_directory),
        &req.output_name,
        req.chat_overlay,
        req.performance,
        bin_dir,
    )
    .await
    .map_err(|err| err.to_string())?;

    Ok(ChatJsonRenderResult {
        output_path: output.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn save_overlay_layout_from_preview(
    _chat_overlay: ChatOverlaySettings,
    _blur_zones: Vec<BlurZone>,
) -> bool {
    true
}

async fn start_ffmpeg_hls_preview(
    media_url: String,
    platform: String,
    binaries_dir: Option<String>,
) -> Result<PreviewSource, String> {
    let bin_dir = binaries_dir.as_deref().map(Path::new);
    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| "ffmpeg.exe not found; RTMP preview requires FFmpeg".to_string())?;

    let id = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join("fetchr-preview").join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create preview dir: {e}"))?;

    let playlist = dir.join("index.m3u8");
    let segment = dir.join("seg_%05d.ts");
    let playlist_arg = playlist.to_string_lossy().to_string();
    let segment_arg = segment.to_string_lossy().to_string();

    let mut cmd = Command::new(ffmpeg);
    hide_console(&mut cmd);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-rw_timeout",
        "15000000",
        "-i",
        &media_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-profile:v",
        "baseline",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-max_muxing_queue_size",
        "1024",
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "4",
        "-hls_flags",
        "delete_segments+append_list+omit_endlist+independent_segments",
        "-hls_segment_filename",
        &segment_arg,
        &playlist_arg,
    ]);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("start ffmpeg preview: {e}"))?;

    sessions().lock().insert(
        id.clone(),
        PreviewSession {
            child,
            dir: dir.clone(),
        },
    );

    let deadline = Instant::now() + Duration::from_secs(9);
    while Instant::now() < deadline {
        if playlist.exists() {
            let preview_url = hls_proxy::register_preview(&id, &dir)?;
            return Ok(PreviewSource {
                id: Some(id),
                url: preview_url,
                input_url: media_url,
                platform,
                transport: "rtmp".to_string(),
                mode: "ffmpeg-hls".to_string(),
                message: Some("RTMP is bridged to low-latency local HLS for preview.".to_string()),
            });
        }
        if let Some(status) = preview_status(&id) {
            let _ = cleanup_preview(&id);
            return Err(format!(
                "ffmpeg preview exited before producing HLS: {status}"
            ));
        }
        sleep(Duration::from_millis(250)).await;
    }

    let _ = cleanup_preview(&id);
    Err("ffmpeg preview timed out before HLS playlist was ready".to_string())
}

fn preview_status(id: &str) -> Option<String> {
    let mut guard = sessions().lock();
    let session = guard.get_mut(id)?;
    match session.child.try_wait() {
        Ok(Some(status)) => Some(status.to_string()),
        Ok(None) => None,
        Err(err) => Some(err.to_string()),
    }
}

#[tauri::command]
pub fn stop_stream_preview(id: String) -> Result<(), String> {
    cleanup_preview(&id)
}

fn cleanup_preview(id: &str) -> Result<(), String> {
    if let Some(mut session) = sessions().lock().remove(id) {
        let _ = session.child.start_kill();
        hls_proxy::unregister_preview(id);
        let _ = std::fs::remove_dir_all(&session.dir);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn twitch_vod_page_is_not_direct_media() {
        assert!(!is_direct_http_media_url(
            "https://www.twitch.tv/videos/2762277714"
        ));
    }

    #[test]
    fn direct_media_urls_are_detected() {
        assert!(is_direct_http_media_url(
            "https://example.com/video.mp4?token=1"
        ));
        assert!(is_direct_http_media_url(
            "https://example.com/live/index-dvr.m3u8"
        ));
        assert!(is_direct_http_media_url(
            "https://rr1---sn.test.googlevideo.com/videoplayback?id=1"
        ));
    }
}
