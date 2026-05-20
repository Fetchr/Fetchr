use std::collections::HashMap;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::Context;
use parking_lot::Mutex;
use tauri::async_runtime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

static PORT: OnceLock<u16> = OnceLock::new();
static PREVIEWS: OnceLock<Mutex<std::collections::HashMap<String, PathBuf>>> = OnceLock::new();
static UNMUTE_STATS: OnceLock<Mutex<std::collections::HashMap<String, UnmuteStats>>> =
    OnceLock::new();

#[derive(Debug, Clone, Default)]
pub struct UnmuteStats {
    pub restore_manifests_found: u32,
    pub restore_manifest_url: Option<String>,
    pub checked_segments: u32,
    pub restored_segments: u32,
    pub unmuted_segments: u32,
    pub muted_fallback_segments: u32,
    pub failed_candidates: Vec<String>,
}

#[derive(Debug, Clone)]
struct RestoreManifest {
    url: String,
    text: String,
}

#[derive(Debug, Clone)]
struct RestoreSegment {
    url: String,
    start_sec: f64,
}

fn previews() -> &'static Mutex<HashMap<String, PathBuf>> {
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn unmute_stats() -> &'static Mutex<HashMap<String, UnmuteStats>> {
    UNMUTE_STATS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start() -> anyhow::Result<u16> {
    let std_listener =
        std::net::TcpListener::bind("127.0.0.1:0").context("binding local HLS proxy")?;
    std_listener
        .set_nonblocking(true)
        .context("configuring local HLS proxy")?;
    let port = std_listener.local_addr()?.port();
    let _ = PORT.set(port);

    async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(err) => {
                tracing::error!("HLS proxy listener error: {err}");
                return;
            }
        };
        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    async_runtime::spawn(async move {
                        if let Err(err) = handle_connection(stream, peer).await {
                            tracing::debug!("HLS proxy request failed: {err}");
                        }
                    });
                }
                Err(err) => tracing::debug!("HLS proxy accept failed: {err}"),
            }
        }
    });

    Ok(port)
}

#[tauri::command]
pub fn proxied_hls_url(url: String, referer: Option<String>) -> Result<String, String> {
    proxied_hls_url_internal(url, referer, false, None)
}

pub fn proxied_hls_url_internal(
    url: String,
    referer: Option<String>,
    unmute_video: bool,
    stats_id: Option<&str>,
) -> Result<String, String> {
    let port = PORT
        .get()
        .copied()
        .ok_or_else(|| "HLS proxy is not running".to_string())?;
    let mut out = format!(
        "http://127.0.0.1:{port}/hls?url={}",
        urlencoding::encode(&url)
    );
    if let Some(referer) = referer.filter(|value| !value.trim().is_empty()) {
        out.push_str("&referer=");
        out.push_str(&urlencoding::encode(&referer));
    }
    if unmute_video {
        out.push_str("&unmute=1");
    }
    if let Some(stats_id) = stats_id.filter(|value| !value.is_empty()) {
        out.push_str("&stats=");
        out.push_str(&urlencoding::encode(stats_id));
    }
    Ok(out)
}

pub fn reset_unmute_stats(id: &str) {
    unmute_stats()
        .lock()
        .insert(id.to_string(), UnmuteStats::default());
}

pub fn take_unmute_stats(id: &str) -> UnmuteStats {
    unmute_stats().lock().remove(id).unwrap_or_default()
}

pub fn register_preview(id: &str, dir: &Path) -> Result<String, String> {
    let port = PORT
        .get()
        .copied()
        .ok_or_else(|| "HLS proxy is not running".to_string())?;
    previews().lock().insert(id.to_string(), dir.to_path_buf());
    Ok(format!("http://127.0.0.1:{port}/preview/{id}/index.m3u8"))
}

pub fn unregister_preview(id: &str) {
    previews().lock().remove(id);
}

async fn handle_connection(mut stream: TcpStream, _peer: SocketAddr) -> anyhow::Result<()> {
    let mut buffer = vec![0_u8; 64 * 1024];
    let read = stream.read(&mut buffer).await?;
    if read == 0 {
        return Ok(());
    }
    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut lines = request.lines();
    let first = lines.next().unwrap_or_default();
    let path = first
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing request path"))?;
    let range = lines
        .find_map(|line| {
            line.strip_prefix("Range:")
                .or_else(|| line.strip_prefix("range:"))
        })
        .map(str::trim)
        .map(str::to_string);

    if path.starts_with("/preview/") {
        serve_preview_file(&mut stream, path).await?;
        return Ok(());
    }

    if !path.starts_with("/hls?") {
        write_response(&mut stream, 404, "text/plain", b"not found", None).await?;
        return Ok(());
    }

    let query = path.split_once('?').map(|(_, q)| q).unwrap_or_default();
    let params = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect::<HashMap<_, _>>();
    let Some(target_url) = params.get("url").cloned() else {
        write_response(&mut stream, 400, "text/plain", b"missing url", None).await?;
        return Ok(());
    };
    let referer = params
        .get("referer")
        .cloned()
        .or_else(|| default_referer(&target_url));
    let unmute_video = params
        .get("unmute")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let stats_id = params.get("stats").cloned();
    let restore_url = params.get("restore").cloned();
    let is_media_segment = params
        .get("media")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let resp = fetch_with_optional_unmute_fallback(
        &client,
        &target_url,
        referer.as_deref(),
        range.as_deref(),
        unmute_video,
        restore_url.as_deref(),
        is_media_segment,
        stats_id.as_deref(),
    )
    .await?;
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_else(|| guess_content_type(&target_url))
        .to_string();
    let content_range = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = resp.bytes().await?.to_vec();

    let body = if looks_like_manifest(&target_url, &content_type) {
        let text = String::from_utf8_lossy(&body);
        let restore_manifest = if unmute_video {
            fetch_restore_manifest(
                &client,
                &target_url,
                referer.as_deref(),
                stats_id.as_deref(),
            )
            .await
        } else {
            None
        };
        rewrite_manifest(
            &text,
            &target_url,
            referer.as_deref(),
            unmute_video,
            stats_id.as_deref(),
            restore_manifest.as_ref(),
        )
        .into_bytes()
    } else {
        body
    };

    let extra_headers = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        Some(format!(
            "Accept-Ranges: bytes\r\n{}",
            content_range
                .as_deref()
                .map(|value| format!("Content-Range: {value}\r\n"))
                .unwrap_or_default()
        ))
    } else {
        None
    };

    write_response(
        &mut stream,
        status.as_u16(),
        if looks_like_manifest(&target_url, &content_type) {
            "application/vnd.apple.mpegurl"
        } else {
            &content_type
        },
        &body,
        extra_headers.as_deref(),
    )
    .await?;
    Ok(())
}

async fn serve_preview_file(stream: &mut TcpStream, request_path: &str) -> anyhow::Result<()> {
    let clean_path = request_path.split('?').next().unwrap_or(request_path);
    let mut parts = clean_path.trim_start_matches('/').split('/');
    if parts.next() != Some("preview") {
        write_response(stream, 404, "text/plain", b"not found", None).await?;
        return Ok(());
    }
    let Some(id) = parts.next() else {
        write_response(stream, 400, "text/plain", b"missing preview id", None).await?;
        return Ok(());
    };
    let Some(file_name) = parts.next() else {
        write_response(stream, 400, "text/plain", b"missing preview file", None).await?;
        return Ok(());
    };
    if parts.next().is_some()
        || file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        write_response(stream, 400, "text/plain", b"bad preview path", None).await?;
        return Ok(());
    }

    let dir = previews().lock().get(id).cloned();
    let Some(dir) = dir else {
        write_response(stream, 404, "text/plain", b"preview not found", None).await?;
        return Ok(());
    };
    let path = dir.join(file_name);
    let body = match tokio::fs::read(&path).await {
        Ok(body) => body,
        Err(_) => {
            write_response(stream, 404, "text/plain", b"preview file not ready", None).await?;
            return Ok(());
        }
    };
    let content_type = guess_content_type(file_name);
    let cache = if file_name.ends_with(".m3u8") {
        Some("Cache-Control: no-store\r\n")
    } else {
        Some("Cache-Control: max-age=2\r\n")
    };
    write_response(stream, 200, content_type, &body, cache).await?;
    Ok(())
}

fn default_referer(url: &str) -> Option<String> {
    if url.contains("twitch.tv") || url.contains("ttvnw.net") || url.contains("cloudfront.net") {
        Some("https://www.twitch.tv/".to_string())
    } else {
        None
    }
}

fn looks_like_manifest(url: &str, content_type: &str) -> bool {
    url.to_lowercase().contains(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("application/vnd.apple")
}

fn guess_content_type(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if lower.contains(".mp4") || lower.contains(".m4s") {
        "video/mp4"
    } else if lower.contains(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    }
}

async fn fetch_with_optional_unmute_fallback(
    client: &reqwest::Client,
    target_url: &str,
    referer: Option<&str>,
    range: Option<&str>,
    unmute_video: bool,
    restore_url: Option<&str>,
    is_media_segment: bool,
    stats_id: Option<&str>,
) -> anyhow::Result<reqwest::Response> {
    let candidates = unmute_fetch_candidates(target_url, unmute_video, restore_url);

    let mut last_resp = None;
    for candidate in candidates.into_iter() {
        let mut req = client.get(&candidate);
        if let Some(referer) = referer {
            req = req.header("Referer", referer);
        }
        if let Some(range) = range {
            req = req.header("Range", range);
        }
        let resp = match req.send().await {
            Ok(resp) => resp,
            Err(err) => {
                record_failed_candidate(stats_id, &candidate, &err.to_string());
                continue;
            }
        };
        if resp.status().is_success() || resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            record_unmute_result(
                stats_id,
                target_url,
                &candidate,
                restore_url,
                unmute_video,
                is_media_segment,
            );
            return Ok(resp);
        }
        record_failed_candidate(stats_id, &candidate, &resp.status().to_string());
        last_resp = Some(resp);
    }

    last_resp.ok_or_else(|| anyhow::anyhow!("no HLS fallback response"))
}

async fn fetch_restore_manifest(
    client: &reqwest::Client,
    target_url: &str,
    referer: Option<&str>,
    stats_id: Option<&str>,
) -> Option<RestoreManifest> {
    let restore_url = unmuted_manifest_candidate(target_url)?;
    let mut req = client.get(&restore_url);
    if let Some(referer) = referer {
        req = req.header("Referer", referer);
    }
    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(err) => {
            record_failed_candidate(stats_id, &restore_url, &err.to_string());
            return None;
        }
    };
    if !resp.status().is_success() {
        record_failed_candidate(stats_id, &restore_url, &resp.status().to_string());
        return None;
    }
    let text = match resp.text().await {
        Ok(text) => text,
        Err(err) => {
            record_failed_candidate(stats_id, &restore_url, &err.to_string());
            return None;
        }
    };
    record_restore_manifest_found(stats_id, target_url, &restore_url);
    Some(RestoreManifest {
        url: restore_url,
        text,
    })
}

fn unmute_fetch_candidates(
    target_url: &str,
    unmute_video: bool,
    restore_url: Option<&str>,
) -> Vec<String> {
    if !unmute_video || looks_like_manifest(target_url, "") {
        return vec![target_url.to_string()];
    }
    let (unmuted, muted) = unmute_candidates(target_url);
    let mut candidates = Vec::with_capacity(3);
    if let Some(restore_url) = restore_url.filter(|url| *url != target_url) {
        candidates.push(restore_url.to_string());
    }
    if target_url.contains("-muted") {
        candidates.push(unmuted);
        candidates.push(target_url.to_string());
        candidates.push(muted);
    } else {
        candidates.push(target_url.to_string());
    }
    candidates.dedup();
    candidates
}

fn unmuted_manifest_candidate(target_url: &str) -> Option<String> {
    let Ok(mut parsed) = url::Url::parse(target_url) else {
        return replace_muted_manifest_path(target_url);
    };
    let path = parsed.path().to_string();
    let restored = replace_muted_manifest_path(&path)?;
    if restored == path {
        return None;
    }
    parsed.set_path(&restored);
    Some(parsed.to_string())
}

fn replace_muted_manifest_path(path: &str) -> Option<String> {
    let marker = "index-muted";
    let idx = path.rfind(marker)?;
    let prefix = &path[..idx];
    Some(format!("{prefix}index-dvr.m3u8"))
}

fn record_restore_manifest_found(stats_id: Option<&str>, original_url: &str, restore_url: &str) {
    let Some(stats_id) = stats_id else {
        return;
    };
    let mut stats = unmute_stats().lock();
    let entry = stats.entry(stats_id.to_string()).or_default();
    entry.restore_manifests_found += 1;
    if entry.restore_manifest_url.is_none() {
        entry.restore_manifest_url = Some(format!("{restore_url} for {original_url}"));
    }
}

fn record_unmute_result(
    stats_id: Option<&str>,
    original_url: &str,
    selected_url: &str,
    restore_url: Option<&str>,
    unmute_video: bool,
    is_media_segment: bool,
) {
    let Some(stats_id) = stats_id else {
        return;
    };
    if !unmute_video || !is_media_segment {
        return;
    }
    let mut stats = unmute_stats().lock();
    let entry = stats.entry(stats_id.to_string()).or_default();
    let has_restore_candidate =
        restore_url.is_some_and(|url| url != original_url) || original_url.contains("-muted");
    if !has_restore_candidate {
        return;
    }
    entry.checked_segments += 1;
    if restore_url.is_some_and(|url| url == selected_url && selected_url != original_url) {
        entry.restored_segments += 1;
    } else if selected_url.contains("-unmuted") {
        entry.restored_segments += 1;
        entry.unmuted_segments += 1;
    } else {
        entry.muted_fallback_segments += 1;
    }
}

fn record_failed_candidate(stats_id: Option<&str>, url: &str, status: &str) {
    let Some(stats_id) = stats_id else {
        return;
    };
    let mut stats = unmute_stats().lock();
    let entry = stats.entry(stats_id.to_string()).or_default();
    if entry.failed_candidates.len() < 10 {
        entry.failed_candidates.push(format!("{status}: {url}"));
    }
}

fn unmute_candidates(target_url: &str) -> (String, String) {
    let Ok(mut parsed) = url::Url::parse(target_url) else {
        return (
            append_segment_suffix(target_url, "-unmuted"),
            append_segment_suffix(target_url, "-muted"),
        );
    };
    let path = parsed.path().to_string();
    parsed.set_path(&append_segment_suffix(&path, "-unmuted"));
    let unmuted = parsed.to_string();
    parsed.set_path(&append_segment_suffix(&path, "-muted"));
    (unmuted, parsed.to_string())
}

fn append_segment_suffix(path: &str, suffix: &str) -> String {
    let (stem, ext) = path
        .rsplit_once('.')
        .map(|(left, right)| (left.to_string(), Some(right.to_string())))
        .unwrap_or_else(|| (path.to_string(), None));
    let clean_stem = stem
        .strip_suffix("-muted")
        .or_else(|| stem.strip_suffix("-unmuted"))
        .unwrap_or(&stem);
    match ext {
        Some(ext) => format!("{clean_stem}{suffix}.{ext}"),
        None => format!("{clean_stem}{suffix}"),
    }
}

fn rewrite_manifest(
    text: &str,
    manifest_url: &str,
    referer: Option<&str>,
    unmute_video: bool,
    stats_id: Option<&str>,
    restore_manifest: Option<&RestoreManifest>,
) -> String {
    let base = match url::Url::parse(manifest_url) {
        Ok(url) => url,
        Err(_) => return text.to_string(),
    };
    let restore_segments = restore_manifest
        .map(|manifest| manifest_segments(&manifest.text, &manifest.url))
        .unwrap_or_default();
    let mut out = String::with_capacity(text.len() + 1024);
    let mut segment_index = 0usize;
    let mut elapsed_sec = 0.0f64;
    let mut pending_duration = None;
    for line in text.lines() {
        if line.starts_with("#EXT-X-KEY") || line.starts_with("#EXT-X-MAP") {
            out.push_str(&rewrite_attribute_uri(
                line,
                &base,
                referer,
                unmute_video,
                stats_id,
            ));
            out.push('\n');
            continue;
        }
        if let Some(duration) = parse_extinf_duration(line) {
            pending_duration = Some(duration);
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if line.trim().is_empty() || line.starts_with('#') {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let restore = restore_segments.get(segment_index).filter(|candidate| {
            (candidate.start_sec - elapsed_sec).abs() < 1.0 || restore_segments.len() == 1
        });
        out.push_str(&proxied_child_url(
            line.trim(),
            &base,
            referer,
            unmute_video,
            stats_id,
            restore.map(|candidate| candidate.url.as_str()),
            true,
        ));
        out.push('\n');
        segment_index += 1;
        elapsed_sec += pending_duration.take().unwrap_or(0.0);
    }
    out
}

fn manifest_segments(text: &str, manifest_url: &str) -> Vec<RestoreSegment> {
    let Ok(base) = url::Url::parse(manifest_url) else {
        return Vec::new();
    };
    let mut segments = Vec::new();
    let mut elapsed_sec = 0.0f64;
    let mut pending_duration = None;
    for line in text.lines() {
        if let Some(duration) = parse_extinf_duration(line) {
            pending_duration = Some(duration);
            continue;
        }
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let url = base
            .join(line.trim())
            .map(|url| url.to_string())
            .unwrap_or_else(|_| line.trim().to_string());
        segments.push(RestoreSegment {
            url,
            start_sec: elapsed_sec,
        });
        elapsed_sec += pending_duration.take().unwrap_or(0.0);
    }
    segments
}

fn parse_extinf_duration(line: &str) -> Option<f64> {
    let rest = line.strip_prefix("#EXTINF:")?;
    let value = rest.split(',').next().unwrap_or_default().trim();
    value.parse::<f64>().ok()
}

fn rewrite_attribute_uri(
    line: &str,
    base: &url::Url,
    referer: Option<&str>,
    unmute_video: bool,
    stats_id: Option<&str>,
) -> String {
    let Some(start) = line.find("URI=\"") else {
        return line.to_string();
    };
    let value_start = start + 5;
    let Some(end) = line[value_start..].find('"').map(|idx| value_start + idx) else {
        return line.to_string();
    };
    let child = &line[value_start..end];
    let rewritten = proxied_child_url(child, base, referer, unmute_video, stats_id, None, false);
    format!("{}{}{}", &line[..value_start], rewritten, &line[end..])
}

fn proxied_child_url(
    child: &str,
    base: &url::Url,
    referer: Option<&str>,
    unmute_video: bool,
    stats_id: Option<&str>,
    restore_url: Option<&str>,
    is_media_segment: bool,
) -> String {
    let absolute = base
        .join(child)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| child.to_string());
    let port = PORT.get().copied().unwrap_or(0);
    let mut out = format!(
        "http://127.0.0.1:{port}/hls?url={}",
        urlencoding::encode(&absolute)
    );
    if let Some(referer) = referer {
        out.push_str("&referer=");
        out.push_str(&urlencoding::encode(referer));
    }
    if unmute_video {
        out.push_str("&unmute=1");
    }
    if let Some(restore_url) = restore_url.filter(|url| !url.is_empty()) {
        out.push_str("&restore=");
        out.push_str(&urlencoding::encode(restore_url));
    }
    if is_media_segment {
        out.push_str("&media=1");
    }
    if let Some(stats_id) = stats_id {
        out.push_str("&stats=");
        out.push_str(&urlencoding::encode(stats_id));
    }
    out
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    extra_headers: Option<&str>,
) -> anyhow::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let mut head = Vec::new();
    write!(
        &mut head,
        "HTTP/1.1 {status} {reason}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n",
        body.len()
    )?;
    if let Some(extra_headers) = extra_headers {
        head.extend_from_slice(extra_headers.as_bytes());
    }
    head.extend_from_slice(b"\r\n");
    stream.write_all(&head).await?;
    stream.write_all(body).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{manifest_segments, rewrite_manifest, unmute_fetch_candidates};

    #[test]
    fn unmute_prefers_unmuted_for_muted_segments() {
        let url = "https://vod-secure.twitch.tv/path/segment-muted.ts";
        let candidates = unmute_fetch_candidates(url, true, None);
        assert_eq!(
            candidates[0],
            "https://vod-secure.twitch.tv/path/segment-unmuted.ts"
        );
        assert!(candidates.contains(&url.to_string()));
    }

    #[test]
    fn ordinary_hls_does_not_rewrite_candidates() {
        let url = "https://vod-secure.twitch.tv/path/segment.ts";
        assert_eq!(
            unmute_fetch_candidates(url, false, None),
            vec![url.to_string()]
        );
    }

    #[test]
    fn unmute_does_not_replace_manifest_as_whole() {
        let url = "https://dgeft87wbj63p.cloudfront.net/vod/1080p60/index-muted-H5AF0J7NP9.m3u8";
        assert_eq!(
            unmute_fetch_candidates(url, true, None),
            vec![url.to_string()]
        );
    }

    #[test]
    fn rewrite_manifest_attaches_restore_segment_candidates_by_index() {
        let muted = "#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXTINF:10.000,\n1.mp4\n";
        let restore = super::RestoreManifest {
            url: "https://vod.example/path/index-dvr.m3u8".to_string(),
            text: "#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXTINF:10.000,\n1.mp4\n".to_string(),
        };
        let rewritten = rewrite_manifest(
            muted,
            "https://vod.example/path/index-muted-abc.m3u8",
            Some("https://www.twitch.tv/"),
            true,
            Some("job"),
            Some(&restore),
        );
        assert!(rewritten.contains("restore=https%3A%2F%2Fvod.example%2Fpath%2F0.mp4"));
        assert!(rewritten.contains("media=1"));
    }

    #[test]
    fn manifest_segments_tracks_elapsed_time() {
        let text = "#EXTM3U\n#EXTINF:10.000,\n0.mp4\n#EXTINF:8.500,\n1.mp4\n";
        let segments = manifest_segments(text, "https://vod.example/path/index-dvr.m3u8");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_sec, 0.0);
        assert_eq!(segments[1].start_sec, 10.0);
    }
}
