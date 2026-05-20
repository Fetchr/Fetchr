use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::jobs::types::{DownloadKind, Job, JobKind, Mode};

#[derive(Debug, Serialize)]
struct TelemetryEnvelope {
    event_type: String,
    app_version: String,
    channel: String,
    machine_id: String,
    sent_at: String,
    payload: Value,
}

pub fn track_app_launch() {
    tauri::async_runtime::spawn(async move {
        send_event("app_launch", json!({})).await;
    });
}

pub fn track_download_completed(job: Job) {
    if matches!(job.spec.job_kind, Some(JobKind::Chat)) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let payload = json!({
            "job_id": job.id.clone(),
            "platform": platform_for_job(&job),
            "streamer": streamer_for_job(&job),
            "mode": mode_label(job.spec.mode),
            "download_kind": download_kind_label(job.spec.download_kind.unwrap_or(DownloadKind::Video)),
            "url_hash": hash_url(&job.spec.url),
            "source_url_hint": source_url_hint(&job.spec.url),
            "chat_source_url_hint": job.spec.chat_source_url.as_deref().and_then(source_url_hint),
            "title": job.spec.meta.title.clone(),
            "thumbnail": job.spec.meta.thumbnail.clone(),
            "output_bytes": output_bytes(&job),
            "download_elapsed_ms": job.progress.download_elapsed_ms,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
        });
        send_event("stream_downloaded", payload).await;
    });
}

async fn send_event(event_type: &str, payload: Value) {
    let Some(url) = crate::remote::join_api_url("/telemetry/events") else {
        return;
    };

    let envelope = TelemetryEnvelope {
        event_type: event_type.to_string(),
        app_version: crate::remote::app_version(),
        channel: crate::remote::APP_CHANNEL.to_string(),
        machine_id: crate::license::current_machine_id(),
        sent_at: Utc::now().to_rfc3339(),
        payload,
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };

    let _ = client.post(url).json(&envelope).send().await;
}

fn platform_for_job(job: &Job) -> String {
    if let Some(platform) = job.spec.meta.platform.as_deref().map(str::trim) {
        if !platform.is_empty() {
            return platform.to_lowercase();
        }
    }

    let lower = format!(
        "{} {}",
        job.spec.url.to_lowercase(),
        job.spec.chat_source_url.as_deref().unwrap_or("").to_lowercase()
    );
    if lower.contains("twitch.tv") {
        "twitch".to_string()
    } else if lower.contains("kick.com") {
        "kick".to_string()
    } else if lower.contains("youtube.com") || lower.contains("youtu.be") {
        "youtube".to_string()
    } else if lower.contains("ttvnw.net")
        || lower.contains("jtvnw.net")
        || lower.contains("twitchcdn.net")
        || lower.contains("cloudfront.net") && parse_streamer_from_url(&job.spec.url).is_some()
    {
        "twitch".to_string()
    } else if lower.contains(".m3u8") {
        "hls".to_string()
    } else {
        "unknown".to_string()
    }
}

fn streamer_for_job(job: &Job) -> Option<String> {
    if let Some(uploader) = job.spec.meta.uploader.as_deref().map(str::trim) {
        if !uploader.is_empty() {
            return Some(uploader.trim_start_matches('@').to_string());
        }
    }

    parse_streamer_from_url(&job.spec.url).or_else(|| {
        job.spec
            .chat_source_url
            .as_deref()
            .and_then(parse_streamer_from_url)
    })
}

fn parse_streamer_from_url(input: &str) -> Option<String> {
    parse_streamer_from_url_inner(input, 0)
}

fn parse_streamer_from_url_inner(input: &str, depth: usize) -> Option<String> {
    if depth > 2 {
        return None;
    }

    let parsed = url::Url::parse(input).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    for (_, value) in parsed.query_pairs() {
        let value = value.trim();
        if value.starts_with("http://") || value.starts_with("https://") {
            if let Some(streamer) = parse_streamer_from_url_inner(value, depth + 1) {
                return Some(streamer);
            }
        }
    }

    if host.contains("twitch.tv") {
        let first = first_path_segment(&parsed)?;
        if matches!(first, "videos" | "video" | "v" | "clip" | "directory") {
            return None;
        }
        return clean_streamer_name(first);
    }

    if host.contains("kick.com") {
        let first = first_path_segment(&parsed)?;
        if matches!(first, "video" | "categories") {
            return None;
        }
        return clean_streamer_name(first);
    }

    if host.contains("youtube.com") || host.contains("youtu.be") {
        let first = first_path_segment(&parsed)?;
        if let Some(handle) = first.strip_prefix('@') {
            return clean_streamer_name(handle);
        }
        if matches!(first, "c" | "channel" | "user") {
            return parsed
                .path_segments()
                .and_then(|mut segments| segments.nth(1))
                .and_then(clean_streamer_name);
        }
    }

    if host.contains("usher.ttvnw.net") {
        let mut segments = parsed.path_segments()?;
        let first = segments.next()?;
        if first == "api" && segments.next() == Some("channel") && segments.next() == Some("hls") {
            return segments
                .next()
                .and_then(|segment| segment.strip_suffix(".m3u8").or(Some(segment)))
                .and_then(clean_streamer_name);
        }
    }

    if input.to_lowercase().contains(".m3u8")
        || host.contains("ttvnw.net")
        || host.contains("jtvnw.net")
        || host.contains("twitchcdn.net")
        || host.contains("cloudfront.net")
    {
        for segment in parsed.path_segments()? {
            if let Some(streamer) = parse_twitch_vod_segment(segment) {
                return Some(streamer);
            }
        }
    }

    None
}

fn first_path_segment(parsed: &url::Url) -> Option<&str> {
    let first = parsed.path_segments()?.next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

fn parse_twitch_vod_segment(segment: &str) -> Option<String> {
    let parts: Vec<&str> = segment.split('_').collect();
    if parts.len() < 4 {
        return None;
    }

    let candidate = parts.get(1)?.trim();
    if candidate.is_empty() || candidate.chars().any(|ch| !(ch.is_ascii_alphanumeric() || ch == '_')) {
        return None;
    }

    clean_streamer_name(candidate)
}

fn clean_streamer_name(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_start_matches('@')
        .trim_end_matches(".m3u8")
        .trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn source_url_hint(input: &str) -> Option<String> {
    let parsed = url::Url::parse(input).ok()?;
    Some(format!(
        "{}://{}{}",
        parsed.scheme(),
        parsed.host_str()?,
        parsed.path()
    ))
}

fn hash_url(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.trim().as_bytes());
    hex::encode(hasher.finalize())
}

fn output_bytes(job: &Job) -> Option<u64> {
    job.output_path
        .as_deref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len())
        .or(job.progress.total_bytes)
        .or(job.progress.downloaded_bytes)
}

fn mode_label(mode: Mode) -> &'static str {
    match mode {
        Mode::Vod => "vod",
        Mode::Live => "live",
    }
}

fn download_kind_label(kind: DownloadKind) -> &'static str {
    match kind {
        DownloadKind::Video => "video",
        DownloadKind::Audio => "audio",
    }
}
