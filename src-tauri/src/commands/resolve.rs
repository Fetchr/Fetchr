use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;

use base64::Engine;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::process::Command;

use crate::binaries::{resolve_binary, FFPROBE, YTDLP};
use crate::proxy::ProxyConfig;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply OS-specific tweaks to hide console windows spawned by child processes on Windows.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quality {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub group: Option<String>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub ext: Option<String>,
    pub has_audio: bool,
    pub has_video: bool,
    pub abr: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolvedStream {
    pub platform: String,
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub is_live: bool,
    pub duration: Option<f64>,
    pub qualities: Vec<Quality>,
    pub direct_url: Option<String>,
    pub thumbnail: Option<String>,
}

/// Detect platform from URL heuristics.
pub fn detect_platform(url: &str) -> String {
    let u = url.to_lowercase();
    if u.contains("twitch.tv") {
        "twitch"
    } else if u.contains("youtube.com") || u.contains("youtu.be") {
        "youtube"
    } else if u.contains("kick.com") {
        "kick"
    } else if u.contains("vkvideo.ru") || u.contains("vk.com") || u.contains("vkplay") {
        "vk"
    } else if u.contains(".m3u8") {
        "hls"
    } else {
        "unknown"
    }
    .to_string()
}

fn recommended_quality(id: &str, label: &str) -> Quality {
    Quality {
        id: id.to_string(),
        label: label.to_string(),
        group: Some("recommended".to_string()),
        height: None,
        fps: None,
        ext: Some("mp4".to_string()),
        has_audio: true,
        has_video: true,
        abr: None,
    }
}

fn normalize_youtube_qualities(raw: Vec<Quality>) -> Vec<Quality> {
    let mut out = vec![
        recommended_quality("bestvideo+bestaudio/best", "Best video + best audio"),
        recommended_quality(
            "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
            "1080p + best audio",
        ),
        recommended_quality(
            "bestvideo[height<=720]+bestaudio/best[height<=720]",
            "720p + best audio",
        ),
        recommended_quality(
            "bestvideo[height<=480]+bestaudio/best[height<=480]",
            "480p + best audio",
        ),
    ];

    let mut combined = raw
        .iter()
        .filter(|q| q.has_video && q.has_audio)
        .cloned()
        .collect::<Vec<_>>();
    combined.sort_by(|a, b| b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0)));
    for mut q in combined.into_iter().take(8) {
        q.group = Some("combined".to_string());
        q.label = format!("{} {}", q.label, q.ext.clone().unwrap_or_default())
            .trim()
            .to_string();
        out.push(q);
    }

    let mut seen_video = std::collections::HashSet::new();
    let mut video = raw
        .iter()
        .filter(|q| q.has_video && !q.has_audio && q.height.is_some())
        .cloned()
        .collect::<Vec<_>>();
    video.sort_by(|a, b| {
        b.height
            .unwrap_or(0)
            .cmp(&a.height.unwrap_or(0))
            .then_with(|| {
                b.fps
                    .unwrap_or(0.0)
                    .partial_cmp(&a.fps.unwrap_or(0.0))
                    .unwrap_or(Ordering::Equal)
            })
    });
    for q in video {
        let key = (
            q.height.unwrap_or(0),
            q.fps.unwrap_or(0.0).round() as u32,
            q.ext.clone().unwrap_or_default(),
        );
        if !seen_video.insert(key) {
            continue;
        }
        let fps = q.fps.unwrap_or(0.0);
        let label = match (q.height, fps > 30.0, q.ext.as_deref()) {
            (Some(h), true, Some(ext)) => format!("{h}p{} {ext} + best audio", fps.round() as u32),
            (Some(h), _, Some(ext)) => format!("{h}p {ext} + best audio"),
            (Some(h), true, _) => format!("{h}p{} + best audio", fps.round() as u32),
            (Some(h), _, _) => format!("{h}p + best audio"),
            _ => format!("{} + best audio", q.label),
        };
        out.push(Quality {
            id: format!("{}+bestaudio/best", q.id),
            label,
            group: Some("video".to_string()),
            height: q.height,
            fps: q.fps,
            ext: q.ext,
            has_audio: true,
            has_video: true,
            abr: q.abr,
        });
        if seen_video.len() >= 12 {
            break;
        }
    }

    let mut audio = raw
        .into_iter()
        .filter(|q| !q.has_video && q.has_audio)
        .collect::<Vec<_>>();
    audio.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(Ordering::Equal)
    });
    for mut q in audio.into_iter().take(6) {
        q.group = Some("audio".to_string());
        out.push(q);
    }

    out
}

async fn resolve_twitch_qualities(
    input_url: &str,
    is_live: bool,
    proxy: Option<&ProxyConfig>,
) -> Result<Vec<Quality>, String> {
    let Some(target) = twitch_target(input_url, is_live) else {
        return Ok(Vec::new());
    };
    let token = fetch_twitch_playback_token(&target, proxy).await?;
    let master_url = match &target {
        TwitchTarget::Vod(id) => {
            let mut url = url::Url::parse(&format!("https://usher.ttvnw.net/vod/{id}.m3u8"))
                .map_err(|e| e.to_string())?;
            url.query_pairs_mut()
                .append_pair("allow_source", "true")
                .append_pair("allow_audio_only", "true")
                .append_pair("include_unavailable", "true")
                .append_pair("platform", "web")
                .append_pair("player_backend", "mediaplayer")
                .append_pair("playlist_include_framerate", "true")
                .append_pair("supported_codecs", "av1,h265,h264")
                .append_pair("sig", &token.signature)
                .append_pair("token", &token.value);
            url.to_string()
        }
        TwitchTarget::Live(login) => {
            let mut url = url::Url::parse(&format!(
                "https://usher.ttvnw.net/api/channel/hls/{login}.m3u8"
            ))
            .map_err(|e| e.to_string())?;
            url.query_pairs_mut()
                .append_pair("allow_source", "true")
                .append_pair("allow_audio_only", "true")
                .append_pair("supported_codecs", "av1,h265,h264")
                .append_pair("fast_bread", "true")
                .append_pair("sig", &token.signature)
                .append_pair("token", &token.value);
            url.to_string()
        }
    };
    let client = twitch_http_client(proxy)?;
    let text = client
        .get(&master_url)
        .header("Referer", "https://www.twitch.tv/")
        .send()
        .await
        .map_err(|e| format!("Twitch usher request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Twitch usher returned {e}"))?
        .text()
        .await
        .map_err(|e| format!("Twitch usher body failed: {e}"))?;
    Ok(parse_twitch_master_playlist(&text, &master_url))
}

pub async fn resolve_twitch_hls_url(
    input_url: &str,
    quality: Option<&str>,
    is_live: bool,
    proxy: &ProxyConfig,
) -> Result<Option<String>, String> {
    if let Some(q) = quality.filter(|q| !q.is_empty() && *q != "best") {
        if q.to_lowercase().contains(".m3u8") {
            return Ok(Some(q.to_string()));
        }
    }
    let qualities = resolve_twitch_qualities(input_url, is_live, Some(proxy)).await?;
    if let Some(requested) = quality.filter(|q| !q.is_empty() && *q != "best") {
        if let Some(matched) = select_requested_twitch_quality(&qualities, requested) {
            return Ok(Some(matched.id.clone()));
        }
    }
    Ok(qualities.first().map(|q| q.id.clone()))
}

enum TwitchTarget {
    Vod(String),
    Live(String),
}

struct TwitchPlaybackToken {
    signature: String,
    value: String,
}

fn twitch_target(input_url: &str, is_live: bool) -> Option<TwitchTarget> {
    let lower = input_url.to_lowercase();
    if let Some(id) = lower
        .split("twitch.tv/videos/")
        .nth(1)
        .and_then(|tail| tail.split(['?', '/', '&']).next())
        .filter(|id| !id.is_empty() && id.chars().all(|ch| ch.is_ascii_digit()))
    {
        return Some(TwitchTarget::Vod(id.to_string()));
    }
    if !is_live {
        return None;
    }
    let parsed = url::Url::parse(input_url).ok()?;
    let host = parsed.host_str()?.trim_start_matches("www.");
    if host != "twitch.tv" {
        return None;
    }
    let login = parsed
        .path_segments()?
        .next()
        .filter(|value| !value.is_empty() && *value != "videos" && *value != "directory")?;
    Some(TwitchTarget::Live(login.to_lowercase()))
}

async fn fetch_twitch_playback_token(
    target: &TwitchTarget,
    proxy: Option<&ProxyConfig>,
) -> Result<TwitchPlaybackToken, String> {
    let (variables, token_key) = match target {
        TwitchTarget::Vod(id) => (
            json!({
                "login": "",
                "isLive": false,
                "vodID": id,
                "isVod": true,
                "playerType": "embed",
                "platform": ""
            }),
            "videoPlaybackAccessToken",
        ),
        TwitchTarget::Live(login) => (
            json!({
                "login": login,
                "isLive": true,
                "vodID": "",
                "isVod": false,
                "playerType": "site",
                "platform": "web"
            }),
            "streamPlaybackAccessToken",
        ),
    };
    let payload = json!({
        "operationName": "PlaybackAccessToken",
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
            }
        },
        "variables": variables
    });
    let client = twitch_http_client(proxy)?;
    let value: serde_json::Value = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Twitch GQL request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Twitch GQL returned {e}"))?
        .json()
        .await
        .map_err(|e| format!("Twitch GQL JSON failed: {e}"))?;
    let data = value
        .get("data")
        .and_then(|data| data.get(token_key))
        .ok_or_else(|| "Twitch playback token missing".to_string())?;
    Ok(TwitchPlaybackToken {
        signature: data
            .get("signature")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        value: data
            .get("value")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

fn twitch_http_client(proxy: Option<&ProxyConfig>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(20));
    if let Some(proxy_url) = proxy.and_then(|proxy| proxy.resolved()) {
        builder = builder.proxy(reqwest::Proxy::all(&proxy_url).map_err(|e| e.to_string())?);
    }
    builder.build().map_err(|e| e.to_string())
}

fn parse_twitch_master_playlist(text: &str, master_url: &str) -> Vec<Quality> {
    let base = url::Url::parse(master_url).ok();
    let mut out = Vec::new();
    let mut pending_stream: Option<HashMap<String, String>> = None;
    let mut unavailable_media = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(data) = line.strip_prefix("#EXT-X-SESSION-DATA:") {
            let attrs = parse_hls_attrs(data);
            if attrs.get("DATA-ID").map(String::as_str) == Some("com.amazon.ivs.unavailable-media")
            {
                if let Some(value) = attrs.get("VALUE") {
                    unavailable_media.extend(parse_twitch_unavailable_media(value));
                }
            }
            continue;
        }
        if let Some(data) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            pending_stream = Some(parse_hls_attrs(data));
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(attrs) = pending_stream.take() else {
            continue;
        };
        let absolute = base
            .as_ref()
            .and_then(|base| base.join(line).ok())
            .map(|url| url.to_string())
            .unwrap_or_else(|| line.to_string());
        let group = attrs
            .get("VIDEO")
            .or_else(|| attrs.get("NAME"))
            .cloned()
            .unwrap_or_else(|| variant_group_from_url(&absolute));
        if group == "audio_only" {
            continue;
        }
        let (width, height) = attrs
            .get("RESOLUTION")
            .and_then(|value| value.split_once('x'))
            .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
            .unwrap_or((0, 0));
        let fps = attrs
            .get("FRAME-RATE")
            .and_then(|value| value.parse::<f32>().ok())
            .or_else(|| parse_fps_from_group(&group));
        let height = if height > 0 {
            Some(height)
        } else {
            parse_height_from_group(&group)
        };
        let label = twitch_quality_label(&group, height, fps, width);
        out.push(Quality {
            id: absolute,
            label,
            group: Some("combined".to_string()),
            height,
            fps,
            ext: Some("m3u8".to_string()),
            has_audio: true,
            has_video: true,
            abr: None,
        });
    }
    append_twitch_unavailable_qualities(&mut out, unavailable_media);
    out.sort_by(|a, b| twitch_quality_rank(b).cmp(&twitch_quality_rank(a)));
    out
}

#[derive(Debug, Deserialize)]
struct TwitchUnavailableMedia {
    #[serde(rename = "NAME")]
    name: Option<String>,
    #[serde(rename = "RESOLUTION")]
    resolution: Option<String>,
    #[serde(rename = "GROUP-ID")]
    group_id: Option<String>,
    #[serde(rename = "FRAME-RATE")]
    frame_rate: Option<f32>,
    #[serde(rename = "BANDWIDTH")]
    bandwidth: Option<u64>,
    #[serde(rename = "CODECS")]
    codecs: Option<String>,
}

fn parse_twitch_unavailable_media(encoded: &str) -> Vec<TwitchUnavailableMedia> {
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return Vec::new();
    };
    serde_json::from_slice::<Vec<TwitchUnavailableMedia>>(&bytes).unwrap_or_default()
}

fn append_twitch_unavailable_qualities(
    qualities: &mut Vec<Quality>,
    unavailable: Vec<TwitchUnavailableMedia>,
) {
    let Some(path_template) = qualities
        .first()
        .and_then(|q| twitch_variant_path_template(&q.id))
    else {
        return;
    };

    for media in unavailable {
        let Some(group_id) = media.group_id.as_deref().filter(|value| !value.is_empty()) else {
            continue;
        };
        let (width, height) = media
            .resolution
            .as_deref()
            .and_then(|value| value.split_once('x'))
            .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
            .unwrap_or((0, 0));
        let Some(height) = (height > 0).then_some(height) else {
            continue;
        };
        let url = path_template
            .replace("{variant}", group_id)
            .replace("%7Bvariant%7D", group_id);
        let label = media
            .name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                twitch_quality_label(group_id, Some(height), media.frame_rate, width)
            });
        let label = if is_source_group_id(group_id) {
            format!("{label} Source")
        } else {
            label
        };
        let has_audio = media
            .codecs
            .as_deref()
            .map(|codecs| codecs.contains("mp4a"))
            .unwrap_or(true);
        let abr = media.bandwidth.map(|bandwidth| bandwidth as f32 / 1000.0);

        if let Some(existing) = qualities.iter_mut().find(|q| q.id == url) {
            if existing.height.unwrap_or(0) < height {
                existing.label = label;
                existing.group = Some("combined".to_string());
                existing.height = Some(height);
                existing.fps = media.frame_rate;
                existing.ext = Some("m3u8".to_string());
                existing.has_audio = has_audio;
                existing.has_video = true;
                existing.abr = abr;
            }
            continue;
        }

        qualities.push(Quality {
            id: url,
            label,
            group: Some("combined".to_string()),
            height: Some(height),
            fps: media.frame_rate,
            ext: Some("m3u8".to_string()),
            has_audio,
            has_video: true,
            abr,
        });
    }
}

fn twitch_variant_path_template(url: &str) -> Option<String> {
    let mut parsed = url::Url::parse(url).ok()?;
    let mut segments = parsed
        .path_segments()?
        .map(str::to_string)
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }
    let variant_index = segments.len().saturating_sub(2);
    segments[variant_index] = "__FETCHR_TWITCH_VARIANT__".to_string();
    parsed.set_path(&segments.join("/"));
    Some(
        parsed
            .to_string()
            .replace("__FETCHR_TWITCH_VARIANT__", "{variant}"),
    )
}

fn parse_hls_attrs(input: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut key = String::new();
    let mut value = String::new();
    let mut in_key = true;
    let mut in_quote = false;
    for ch in input.chars().chain(std::iter::once(',')) {
        match ch {
            '=' if in_key => in_key = false,
            '"' => in_quote = !in_quote,
            ',' if !in_quote => {
                if !key.trim().is_empty() {
                    out.insert(
                        key.trim().to_string(),
                        value.trim().trim_matches('"').to_string(),
                    );
                }
                key.clear();
                value.clear();
                in_key = true;
            }
            _ if in_key => key.push(ch),
            _ => value.push(ch),
        }
    }
    out
}

fn variant_group_from_url(url: &str) -> String {
    url.split('/').rev().nth(1).unwrap_or_default().to_string()
}

fn parse_height_from_group(group: &str) -> Option<u32> {
    group
        .split('p')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
}

fn parse_fps_from_group(group: &str) -> Option<f32> {
    group
        .split('p')
        .nth(1)
        .and_then(|value| value.parse::<f32>().ok())
}

fn twitch_quality_label(group: &str, height: Option<u32>, fps: Option<f32>, width: u32) -> String {
    if group == "chunked" {
        if let Some(height) = height {
            return match fps {
                Some(fps) if fps > 1.0 => format!("Source {height}p{}", fps.round() as u32),
                _ => format!("Source {height}p"),
            };
        }
        return "Source".to_string();
    }
    if let Some(height) = height {
        return match fps {
            Some(fps) if fps > 1.0 => format!("{height}p{}", fps.round() as u32),
            _ => format!("{height}p"),
        };
    }
    if width > 0 {
        return format!("{width}w");
    }
    group.to_string()
}

fn twitch_quality_rank(q: &Quality) -> (u8, u32, u32) {
    (
        if is_twitch_source_quality(q) { 1 } else { 0 },
        q.height.unwrap_or(0),
        q.fps.unwrap_or(0.0).round() as u32,
    )
}

fn twitch_resolution_rank(q: &Quality) -> (u32, u32, u8) {
    (
        q.height.unwrap_or(0),
        q.fps.unwrap_or(0.0).round() as u32,
        if is_twitch_source_quality(q) { 1 } else { 0 },
    )
}

fn is_twitch_source_quality(q: &Quality) -> bool {
    q.id.contains("/chunked/")
        || q.id.contains("chunked")
        || q.label.to_lowercase().contains("source")
}

fn is_source_group_id(group_id: &str) -> bool {
    group_id.eq_ignore_ascii_case("chunked") || group_id.eq_ignore_ascii_case("source")
}

fn select_requested_twitch_quality<'a>(
    qualities: &'a [Quality],
    requested: &str,
) -> Option<&'a Quality> {
    let requested_lower = requested.to_lowercase();
    if let Some(exact) = qualities
        .iter()
        .find(|q| q.id.eq_ignore_ascii_case(requested) || q.label.eq_ignore_ascii_case(requested))
    {
        return Some(exact);
    }

    let desired_height = parse_requested_height(&requested_lower)?;
    let desired_fps = parse_requested_fps(&requested_lower);
    qualities
        .iter()
        .filter(|q| q.height == Some(desired_height))
        .filter(|q| {
            desired_fps
                .map(|fps| {
                    q.fps
                        .map(|actual| (actual - fps).abs() < 1.0)
                        .unwrap_or(true)
                })
                .unwrap_or(true)
        })
        .max_by_key(|q| twitch_resolution_rank(q))
        .or_else(|| {
            if desired_height >= 1440 {
                qualities
                    .iter()
                    .filter(|q| is_twitch_source_quality(q))
                    .max_by_key(|q| twitch_quality_rank(q))
            } else {
                None
            }
        })
        .or_else(|| {
            qualities
                .iter()
                .filter(|q| q.height.unwrap_or(0) <= desired_height)
                .max_by_key(|q| twitch_resolution_rank(q))
        })
}

fn parse_requested_height(value: &str) -> Option<u32> {
    static HEIGHT_RE: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)(?:height\s*<=\s*|height\s*=\s*|^|[^0-9])(?P<h>[1-9][0-9]{2,3})\s*p?",
        )
        .expect("height regex")
    });
    HEIGHT_RE
        .captures(value)
        .and_then(|captures| captures.name("h"))
        .and_then(|height| height.as_str().parse::<u32>().ok())
}

fn parse_requested_fps(value: &str) -> Option<f32> {
    static FPS_RE: Lazy<regex::Regex> =
        Lazy::new(|| regex::Regex::new(r"(?i)[0-9]{3,4}p(?P<fps>[0-9]{2,3})").expect("fps regex"));
    FPS_RE
        .captures(value)
        .and_then(|captures| captures.name("fps"))
        .and_then(|fps| fps.as_str().parse::<f32>().ok())
}

#[tauri::command]
pub async fn resolve_stream(
    url: String,
    proxy: Option<ProxyConfig>,
    binaries_dir: Option<String>,
) -> Result<ResolvedStream, String> {
    let bin_dir = binaries_dir.as_deref().map(Path::new);
    let platform = detect_platform(&url);

    // For plain m3u8 we can't ask yt-dlp — return minimal info.
    if platform == "hls" {
        return Ok(ResolvedStream {
            platform,
            title: None,
            uploader: None,
            is_live: false,
            duration: None,
            qualities: vec![],
            direct_url: Some(url),
            thumbnail: None,
        });
    }

    let ytdlp = resolve_binary(YTDLP, bin_dir).ok_or_else(|| "yt-dlp.exe not found".to_string())?;

    let mut cmd = Command::new(&ytdlp);
    configure_ytdlp_env(&mut cmd);
    hide_console(&mut cmd);
    cmd.args(["-J", "--no-warnings", "--no-check-certificates"]);
    if let Some(px) = proxy.as_ref().and_then(|p| p.for_ytdlp()) {
        cmd.args(["--proxy", &px]);
    }
    cmd.arg(&url);

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "yt-dlp failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let info: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let mut qualities = info
        .get("formats")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let id = f.get("format_id")?.as_str()?.to_string();
                    let height = f.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);
                    let fps = f.get("fps").and_then(|v| v.as_f64()).map(|v| v as f32);
                    let ext = f.get("ext").and_then(|v| v.as_str()).map(str::to_string);
                    let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("");
                    let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("");
                    let abr = f.get("abr").and_then(|v| v.as_f64()).map(|v| v as f32);
                    let has_video = vcodec != "none";
                    let has_audio = acodec != "none";

                    if !has_video && !has_audio {
                        return None;
                    }

                    let label = if has_video {
                        match (height, fps) {
                            (Some(h), Some(f)) if f > 1.0 => format!("{h}p{}", f.round() as u32),
                            (Some(h), _) => format!("{h}p"),
                            _ => id.clone(),
                        }
                    } else if let Some(rate) = abr {
                        format!("audio {}", rate.round() as u32)
                    } else {
                        "audio".to_string()
                    };
                    Some(Quality {
                        id,
                        label,
                        group: Some(
                            match (has_video, has_audio) {
                                (true, true) => "combined",
                                (true, false) => "video",
                                (false, true) => "audio",
                                _ => "other",
                            }
                            .to_string(),
                        ),
                        height,
                        fps,
                        ext,
                        has_audio,
                        has_video,
                        abr,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    qualities.sort_by(|a, b| {
        let by_stream_kind = match (a.has_video, b.has_video) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => Ordering::Equal,
        };
        if by_stream_kind != Ordering::Equal {
            return by_stream_kind;
        }

        if a.has_video && b.has_video {
            let by_height = b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0));
            if by_height != Ordering::Equal {
                return by_height;
            }
            let by_audio = b.has_audio.cmp(&a.has_audio);
            if by_audio != Ordering::Equal {
                return by_audio;
            }
            return b
                .fps
                .unwrap_or(0.0)
                .partial_cmp(&a.fps.unwrap_or(0.0))
                .unwrap_or(Ordering::Equal);
        }

        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(Ordering::Equal)
    });

    if platform == "youtube" {
        qualities = normalize_youtube_qualities(qualities);
    }
    let is_live = info
        .get("is_live")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut direct_url = info.get("url").and_then(|v| v.as_str()).map(str::to_string);
    if platform == "twitch" {
        match resolve_twitch_qualities(&url, is_live, proxy.as_ref()).await {
            Ok(twitch_qualities) if !twitch_qualities.is_empty() => {
                direct_url = twitch_qualities.first().map(|q| q.id.clone());
                qualities = twitch_qualities;
            }
            Ok(_) => {}
            Err(err) => {
                eprintln!("Twitch quality resolver fallback to yt-dlp formats: {err}");
            }
        }
    }

    Ok(ResolvedStream {
        platform,
        title: info
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        uploader: info
            .get("uploader")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        is_live,
        duration: info.get("duration").and_then(|v| v.as_f64()),
        qualities,
        direct_url,
        thumbnail: info
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

/// Resolve a playable direct HLS URL suitable for in-app preview.
/// Uses `yt-dlp -g` which returns the best variant's direct media URL.
#[tauri::command]
pub async fn resolve_direct_url(
    url: String,
    proxy: Option<ProxyConfig>,
    binaries_dir: Option<String>,
    quality: Option<String>,
) -> Result<String, String> {
    let bin_dir = binaries_dir.as_deref().map(Path::new);

    // Plain m3u8 — nothing to resolve.
    if url.to_lowercase().contains(".m3u8") {
        return Ok(url);
    }
    if let Some(q) = quality.as_deref().filter(|q| !q.is_empty() && *q != "best") {
        if q.to_lowercase().contains(".m3u8") {
            return Ok(q.to_string());
        }
    }

    let ytdlp = resolve_binary(YTDLP, bin_dir).ok_or_else(|| "yt-dlp.exe not found".to_string())?;

    let mut cmd = Command::new(&ytdlp);
    configure_ytdlp_env(&mut cmd);
    hide_console(&mut cmd);
    cmd.arg("-g")
        .arg("--no-check-certificates")
        .arg("--no-warnings");

    let preview_format = match quality.as_deref() {
        Some(q) if !q.is_empty() && q != "best" => {
            format!("{q}/best[protocol^=m3u8]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best")
        }
        _ => "best[protocol^=m3u8]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best".to_string(),
    };
    cmd.args(["-f", &preview_format]);

    if let Some(px) = proxy.as_ref().and_then(|p| p.for_ytdlp()) {
        cmd.args(["--proxy", &px]);
    }

    cmd.arg(&url);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "yt-dlp -g failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .find(|l| l.to_lowercase().contains(".m3u8"))
        .or_else(|| {
            text.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .find(|l| l.starts_with("http://") || l.starts_with("https://"))
        })
        .map(|s| s.to_string())
        .ok_or_else(|| "empty yt-dlp -g output".to_string())
}

#[tauri::command]
pub async fn probe_duration(
    path: String,
    binaries_dir: Option<String>,
) -> Result<Option<f64>, String> {
    let bin_dir = binaries_dir.as_deref().map(Path::new);
    let ffprobe = match resolve_binary(FFPROBE, bin_dir) {
        Some(p) => p,
        None => return Ok(None),
    };
    let mut cmd = Command::new(ffprobe);
    hide_console(&mut cmd);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
    ])
    .arg(&path);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .ok())
}

fn configure_ytdlp_env(cmd: &mut Command) {
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONLEGACYWINDOWSSTDIO", "0");
}

/// Fetch arbitrary text (HLS manifests, playlists) via Rust so the
/// frontend can side-step WebView CORS + origin-header restrictions.
/// Twitch live-weaver manifests in particular reject requests with
/// an `Origin: tauri://*` header.
#[tauri::command]
pub async fn fetch_text(url: String, referer: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if let Some(r) = referer {
        req = req.header("Referer", r);
    } else if url.contains(".ttvnw.net") || url.contains("twitch.tv") {
        req = req.header("Referer", "https://www.twitch.tv/");
    }

    let resp = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), url));
    }
    resp.text().await.map_err(|e| format!("read body: {e}"))
}

/// Fetch binary HLS resources (segments, init fragments, keys) via Rust so
/// the frontend can play Twitch and other strict HLS sources without WebView
/// CORS/origin/header issues.
#[tauri::command]
pub async fn fetch_bytes(
    url: String,
    referer: Option<String>,
    range_start: Option<u64>,
    range_end: Option<u64>,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if let Some(r) = referer {
        req = req.header("Referer", r);
    } else if url.contains(".ttvnw.net")
        || url.contains("twitch.tv")
        || url.contains("cloudfront.net")
    {
        req = req.header("Referer", "https://www.twitch.tv/");
    }

    if range_start.is_some() || range_end.is_some() {
        let start = range_start.map(|v| v.to_string()).unwrap_or_default();
        let end = range_end.map(|v| v.to_string()).unwrap_or_default();
        req = req.header("Range", format!("bytes={start}-{end}"));
    }

    let resp = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    if !(status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT) {
        return Err(format!("HTTP {}: {}", status.as_u16(), url));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("read body: {e}"))
}
