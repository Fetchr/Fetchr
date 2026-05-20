use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use chrono::DateTime;
use futures::{stream, StreamExt};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::chat_overlay::emit_log;
use crate::chat_overlay::model::{
    read_chat_messages, write_chat_messages, ChatBadge, ChatFragment, ChatMessage,
};
use crate::chat_overlay::parse_hms;
use crate::jobs::queue::QueueManager;
use crate::jobs::types::{Job, JobProgress, PerformanceProfile};

use super::settings::EffectiveChatOverlaySettings;

#[async_trait]
pub trait ChatProvider {
    async fn download_chat(
        &self,
        job: &Job,
        _settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<ChatMessage>>;
}

pub fn provider_for_job(job: &Job, ytdlp: Option<PathBuf>) -> Box<dyn ChatProvider + Send + Sync> {
    let platform = job
        .spec
        .meta
        .platform
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let url = job.spec.url.to_ascii_lowercase();
    let chat_url = job
        .spec
        .chat_source_url
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    if platform.contains("twitch") || url.contains("twitch.tv") || chat_url.contains("twitch.tv") {
        Box::new(TwitchChatProvider::new())
    } else if platform.contains("kick") || url.contains("kick.com") {
        Box::new(KickChatProvider::new(ytdlp))
    } else {
        Box::new(YtDlpChatProvider { ytdlp })
    }
}

struct TwitchChatProvider {
    client: reqwest::Client,
}

impl TwitchChatProvider {
    fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    async fn download_chat_parallel(
        &self,
        job: &Job,
        settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
        video_id: &str,
        query_start: i32,
        max_offset: Option<i32>,
        workers: usize,
    ) -> Result<Vec<ChatMessage>> {
        let max_offset = max_offset.ok_or_else(|| anyhow!("Twitch chat end offset is unknown"))?;
        let run_last_to_end = job.spec.end.is_none();
        let segments = twitch_chat_segments(query_start, max_offset, workers, run_last_to_end);
        if segments.len() < 2 {
            return Err(anyhow!(
                "not enough Twitch chat ranges for parallel download"
            ));
        }

        let started = Instant::now();
        let total_segments = segments.len();
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: parallel Twitch chat download with {workers} workers across {total_segments} time ranges"
            ),
        );

        let mut messages = Vec::new();
        let mut seen_ids = HashSet::new();
        let mut channel_id: Option<String> = None;
        let mut completed_segments = 0_usize;
        let mut total_pages = 0_usize;
        let video_id = video_id.to_string();
        let job_id = job.id.clone();
        let segment_progress = Arc::new(Mutex::new(vec![0.0_f32; total_segments]));

        let mut stream = stream::iter(segments.into_iter().enumerate().map(|(index, range)| {
            let client = self.client.clone();
            let queue = Arc::clone(queue);
            let cancel = Arc::clone(&cancel);
            let video_id = video_id.clone();
            let job_id = job_id.clone();
            let segment_progress = Arc::clone(&segment_progress);
            async move {
                fetch_twitch_chat_segment(
                    client,
                    video_id,
                    index + 1,
                    range,
                    max_offset,
                    queue,
                    job_id,
                    cancel,
                    segment_progress,
                )
                .await
            }
        }))
        .buffer_unordered(workers);

        while let Some(result) = stream.next().await {
            let result = result?;
            completed_segments += 1;
            total_pages += result.pages;
            if channel_id.is_none() {
                channel_id = result.channel_id;
            }
            let mut added = 0_usize;
            for fetched in result.messages {
                if !fetched.id.is_empty() && !seen_ids.insert(fetched.id) {
                    continue;
                }
                messages.push(fetched.message);
                added += 1;
            }

            if let Ok(mut progress) = segment_progress.lock() {
                if let Some(slot) = progress.get_mut(result.index.saturating_sub(1)) {
                    *slot = 100.0;
                }
            }
            let percent = average_segment_progress(&segment_progress);
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let ranges_per_sec = completed_segments as f64 / elapsed;
            let remaining = total_segments.saturating_sub(completed_segments) as f64;
            let eta = if ranges_per_sec > 0.0 {
                Some(format_duration(remaining / ranges_per_sec))
            } else {
                None
            };
            queue.set_progress(
                &job.id,
                JobProgress {
                    percent,
                    speed: Some(format!("{ranges_per_sec:.1} ranges/s")),
                    eta,
                    current_segment: Some(format!(
                        "{completed_segments}/{total_segments} ranges, {total_pages} pages"
                    )),
                    message: Some(format!(
                        "Downloading chat replay ({completed_segments}/{total_segments} ranges)"
                    )),
                    ..JobProgress::default()
                },
            );
            emit_log(
                queue,
                &job.id,
                &format!(
                    "Chat overlay: Twitch range {}/{} {}-{}s done, +{}, {} messages",
                    result.index,
                    total_segments,
                    result.range.start,
                    result.range.end,
                    added,
                    messages.len()
                ),
            );
        }

        if let Some(channel_id) = channel_id.as_deref() {
            apply_twitch_badge_urls(&self.client, channel_id, &mut messages).await;
            apply_third_party_emotes(
                &self.client,
                channel_id,
                settings,
                &mut messages,
                queue,
                &job.id,
            )
            .await;
        }

        if messages.is_empty() {
            return Err(anyhow!("Twitch chat replay is empty or unavailable"));
        }

        disperse_same_second_twitch_offsets(&mut messages);
        messages.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
        write_chat_messages(output_json, &messages)?;
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: parallel Twitch chat download finished in {}, {} pages, {} messages",
                format_duration(started.elapsed().as_secs_f64()),
                total_pages,
                messages.len()
            ),
        );
        Ok(messages)
    }
}

#[async_trait]
impl ChatProvider for TwitchChatProvider {
    async fn download_chat(
        &self,
        job: &Job,
        settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<ChatMessage>> {
        let chat_source = job
            .spec
            .chat_source_url
            .as_deref()
            .filter(|url| !url.trim().is_empty())
            .unwrap_or(&job.spec.url);
        emit_log(queue, &job.id, &format!("Chat source URL: {chat_source}"));
        let video_id = parse_twitch_video_id(chat_source)
            .ok_or_else(|| anyhow!("Twitch VOD id not found in URL"))?;
        let query_start = chat_query_start(job, settings);
        let metadata = fetch_twitch_video_metadata(&self.client, &video_id)
            .await
            .map_err(|err| {
                emit_log(
                    queue,
                    &job.id,
                    &format!("!! Chat overlay: Twitch video metadata unavailable: {err:#}"),
                );
                err
            })
            .ok();
        let max_offset = chat_query_end(job, settings).or_else(|| {
            metadata
                .as_ref()
                .and_then(|meta| meta.length_seconds)
                .map(|duration| duration.ceil() as i32)
        });
        let parallel_workers = twitch_chat_parallel_workers(job, query_start, max_offset);
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: Twitch chat download range {}-{}s, workers {}",
                query_start,
                max_offset
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                parallel_workers
            ),
        );
        if parallel_workers > 1 {
            match self
                .download_chat_parallel(
                    job,
                    settings,
                    output_json,
                    queue,
                    cancel.clone(),
                    &video_id,
                    query_start,
                    max_offset,
                    parallel_workers,
                )
                .await
            {
                Ok(messages) => return Ok(messages),
                Err(err) if !cancel.load(Ordering::SeqCst) => {
                    emit_log(
                        queue,
                        &job.id,
                        &format!(
                            "!! Chat overlay: parallel Twitch chat download failed, falling back to sequential mode: {err:#}"
                        ),
                    );
                }
                Err(err) => return Err(err),
            }
        }
        let mut messages = Vec::new();
        let mut seen_ids = HashSet::new();
        let mut channel_id: Option<String> =
            metadata.as_ref().and_then(|meta| meta.owner_id.clone());
        let mut page = 0;
        let mut query_offset = query_start;
        let mut cursor: Option<String> = None;
        let mut cursor_pagination_rejected = false;
        let mut last_newest_timestamp = query_offset;
        let mut empty_pages = 0_u32;
        let mut request_errors = 0_u32;

        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            page += 1;
            let response: Value = match fetch_twitch_comments_value(
                &self.client,
                &video_id,
                cursor.as_deref(),
                query_offset,
            )
            .await
            {
                Ok(value) => {
                    request_errors = 0;
                    value
                }
                Err(err) => {
                    request_errors += 1;
                    if request_errors > 10 {
                        return Err(err);
                    }
                    emit_log(
                        queue,
                        &job.id,
                        &format!(
                            "Chat overlay: Twitch GraphQL request failed at page {page}; retry {request_errors}/10: {err:#}"
                        ),
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(
                        1000 * request_errors as u64,
                    ))
                    .await;
                    page -= 1;
                    continue;
                }
            };

            if let Some(errors) = response.get("errors") {
                if cursor.is_some() && is_twitch_integrity_error(errors) {
                    cursor = None;
                    cursor_pagination_rejected = true;
                    query_offset = (last_newest_timestamp + 1).max(query_offset + 1);
                    page -= 1;
                    emit_log(
                        queue,
                        &job.id,
                        &format!(
                            "Chat overlay: Twitch rejected cursor pagination; retrying from {query_offset}s by offset"
                        ),
                    );
                    continue;
                }
                emit_log(
                    queue,
                    &job.id,
                    &format!("Chat overlay: Twitch GraphQL error: {errors}"),
                );
                return Err(anyhow!("Twitch GraphQL error: {errors}"));
            }

            let video = response
                .pointer("/data/video")
                .cloned()
                .unwrap_or(Value::Null);
            if channel_id.is_none() {
                channel_id = video
                    .pointer("/owner/id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            let edges = video
                .pointer("/comments/edges")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if edges.is_empty() {
                empty_pages += 1;
                if empty_pages <= 3 {
                    emit_log(
                        queue,
                        &job.id,
                        &format!(
                            "Chat overlay: Twitch returned empty comment page {page}; retry {empty_pages}/3"
                        ),
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(250 * empty_pages as u64))
                        .await;
                    page -= 1;
                    continue;
                }
                break;
            }
            empty_pages = 0;

            let mut added = 0_usize;
            let mut newest_timestamp = query_offset;
            let mut next_cursor = None;
            for edge in edges {
                next_cursor = edge
                    .get("cursor")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or(next_cursor);
                if let Some(node) = edge.get("node") {
                    newest_timestamp = node
                        .get("contentOffsetSeconds")
                        .and_then(Value::as_i64)
                        .map(|v| v as i32)
                        .unwrap_or(newest_timestamp)
                        .max(newest_timestamp);
                    if max_offset
                        .map(|max| {
                            node.get("contentOffsetSeconds")
                                .and_then(Value::as_f64)
                                .map(|timestamp| timestamp > max as f64)
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                    {
                        continue;
                    }
                    let id = node
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !id.is_empty() && !seen_ids.insert(id) {
                        continue;
                    }
                    if let Some(message) = parse_twitch_message(node) {
                        messages.push(message);
                        added += 1;
                    }
                }
            }

            emit_log(
                queue,
                &job.id,
                &format!(
                    "Chat overlay: Twitch chat page {page} at {}s, +{added}, {} messages",
                    newest_timestamp,
                    messages.len()
                ),
            );
            last_newest_timestamp = newest_timestamp;

            let has_next = video
                .pointer("/comments/pageInfo/hasNextPage")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !has_next
                || max_offset
                    .map(|max| newest_timestamp > max)
                    .unwrap_or(false)
            {
                break;
            }
            if cursor_pagination_rejected {
                cursor = None;
                query_offset = (newest_timestamp + 1).max(query_offset + 1);
                continue;
            }
            if next_cursor.is_none() || next_cursor.as_ref() == cursor.as_ref() {
                break;
            }
            cursor = next_cursor;
        }

        if let Some(channel_id) = channel_id.as_deref() {
            apply_twitch_badge_urls(&self.client, channel_id, &mut messages).await;
            apply_third_party_emotes(
                &self.client,
                channel_id,
                settings,
                &mut messages,
                queue,
                &job.id,
            )
            .await;
        }

        if messages.is_empty() {
            return Err(anyhow!("Twitch chat replay is empty or unavailable"));
        }

        disperse_same_second_twitch_offsets(&mut messages);
        messages.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
        write_chat_messages(output_json, &messages)?;
        Ok(messages)
    }
}

#[derive(Debug, Clone, Copy)]
struct TwitchChatRange {
    start: i32,
    end: i32,
    run_to_end: bool,
}

#[derive(Debug)]
struct TwitchFetchedMessage {
    id: String,
    message: ChatMessage,
}

#[derive(Debug)]
struct TwitchSegmentResult {
    index: usize,
    range: TwitchChatRange,
    channel_id: Option<String>,
    messages: Vec<TwitchFetchedMessage>,
    pages: usize,
}

struct TwitchVideoMetadata {
    owner_id: Option<String>,
    length_seconds: Option<f64>,
    #[allow(dead_code)]
    created_at: Option<String>,
}

async fn fetch_twitch_video_metadata(
    client: &reqwest::Client,
    video_id: &str,
) -> Result<TwitchVideoMetadata> {
    let body = json!({
        "query": "query($id: ID!){video(id:$id){createdAt,lengthSeconds,owner{id}}}",
        "variables": { "id": video_id }
    });
    let value = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .context("Twitch video metadata request")?
        .error_for_status()
        .context("Twitch video metadata status")?
        .json::<Value>()
        .await
        .context("Twitch video metadata JSON")?;
    let video = value.pointer("/data/video").unwrap_or(&Value::Null);
    Ok(TwitchVideoMetadata {
        owner_id: video
            .pointer("/owner/id")
            .and_then(Value::as_str)
            .map(str::to_string),
        length_seconds: video.get("lengthSeconds").and_then(Value::as_f64),
        created_at: video
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

async fn fetch_twitch_chat_segment(
    client: reqwest::Client,
    video_id: String,
    index: usize,
    range: TwitchChatRange,
    max_offset: i32,
    queue: Arc<QueueManager>,
    job_id: String,
    cancel: Arc<AtomicBool>,
    segment_progress: Arc<Mutex<Vec<f32>>>,
) -> Result<TwitchSegmentResult> {
    let mut messages = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut channel_id: Option<String> = None;
    let mut page = 0_usize;
    let mut query_offset = range.start;
    let mut cursor: Option<String> = None;
    let mut cursor_pagination_rejected = false;
    let mut last_newest_timestamp = range.start;
    let mut empty_pages = 0_u32;
    let mut request_errors = 0_u32;

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(anyhow!("cancelled"));
        }
        page += 1;
        let response: Value = match fetch_twitch_comments_value(
            &client,
            &video_id,
            cursor.as_deref(),
            query_offset,
        )
        .await
        {
            Ok(value) => {
                request_errors = 0;
                value
            }
            Err(err) => {
                request_errors += 1;
                if request_errors > 10 {
                    return Err(err);
                }
                emit_log(
                    &queue,
                    &job_id,
                    &format!(
                        "Chat overlay: Twitch range {index} request failed at page {page}; retry {request_errors}/10: {err:#}"
                    ),
                );
                tokio::time::sleep(std::time::Duration::from_millis(
                    1000 * request_errors as u64,
                ))
                .await;
                page -= 1;
                continue;
            }
        };

        if let Some(errors) = response.get("errors") {
            if cursor.is_some() && is_twitch_integrity_error(errors) {
                cursor = None;
                cursor_pagination_rejected = true;
                query_offset = (last_newest_timestamp + 1).max(query_offset + 1);
                page -= 1;
                emit_log(
                    &queue,
                    &job_id,
                    &format!(
                        "Chat overlay: Twitch rejected cursor for range {index}; retrying from {query_offset}s by offset"
                    ),
                );
                continue;
            }
            emit_log(
                &queue,
                &job_id,
                &format!("Chat overlay: Twitch range {index} GraphQL error: {errors}"),
            );
            return Err(anyhow!("Twitch GraphQL error: {errors}"));
        }

        let video = response
            .pointer("/data/video")
            .cloned()
            .unwrap_or(Value::Null);
        if channel_id.is_none() {
            channel_id = video
                .pointer("/owner/id")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        let edges = video
            .pointer("/comments/edges")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if edges.is_empty() {
            empty_pages += 1;
            if empty_pages <= 3 {
                tokio::time::sleep(std::time::Duration::from_millis(250 * empty_pages as u64))
                    .await;
                page -= 1;
                continue;
            }
            break;
        }
        empty_pages = 0;

        let mut added = 0_usize;
        let mut newest_timestamp = query_offset;
        let mut next_cursor = None;
        for edge in edges {
            next_cursor = edge
                .get("cursor")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(next_cursor);
            if let Some(node) = edge.get("node") {
                let timestamp = node
                    .get("contentOffsetSeconds")
                    .and_then(Value::as_f64)
                    .unwrap_or(query_offset as f64);
                newest_timestamp = (timestamp.floor() as i32).max(newest_timestamp);
                if timestamp < range.start as f64
                    || (!range.run_to_end && timestamp >= range.end as f64)
                    || timestamp > max_offset as f64
                {
                    continue;
                }
                let id = node
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if !id.is_empty() && !seen_ids.insert(id.clone()) {
                    continue;
                }
                if let Some(message) = parse_twitch_message(node) {
                    messages.push(TwitchFetchedMessage { id, message });
                    added += 1;
                }
            }
        }

        if page == 1 || page % 10 == 0 || newest_timestamp >= range.end {
            emit_log(
                &queue,
                &job_id,
                &format!(
                    "Chat overlay: Twitch range {index} page {page} at {}s, +{added}, {} range messages",
                    newest_timestamp,
                    messages.len()
                ),
            );
        }
        last_newest_timestamp = newest_timestamp;
        update_twitch_segment_progress(
            &segment_progress,
            index,
            range,
            newest_timestamp,
            &queue,
            &job_id,
        );

        let has_next = video
            .pointer("/comments/pageInfo/hasNextPage")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !has_next
            || (!range.run_to_end && newest_timestamp >= range.end)
            || newest_timestamp > max_offset
        {
            break;
        }
        if cursor_pagination_rejected {
            cursor = None;
            query_offset = (newest_timestamp + 1).max(query_offset + 1);
            continue;
        }
        if next_cursor.is_none() || next_cursor.as_ref() == cursor.as_ref() {
            break;
        }
        cursor = next_cursor;
    }

    Ok(TwitchSegmentResult {
        index,
        range,
        channel_id,
        messages,
        pages: page,
    })
}

async fn fetch_twitch_comments_value(
    client: &reqwest::Client,
    video_id: &str,
    cursor: Option<&str>,
    query_offset: i32,
) -> Result<Value> {
    let value = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", "kd1unb4b3q4t58fwlpcbzcbnm76a8fp")
        .header("Content-Type", "application/json")
        .json(&twitch_comments_persisted_body(
            video_id,
            cursor,
            query_offset,
        ))
        .send()
        .await
        .context("Twitch GraphQL persisted request")?
        .error_for_status()
        .context("Twitch GraphQL persisted status")?
        .json::<Value>()
        .await
        .context("Twitch GraphQL persisted JSON")?;
    if should_retry_comments_full_query(value.get("errors")) {
        return client
            .post("https://gql.twitch.tv/gql")
            .header("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")
            .header("Content-Type", "application/json")
            .json(&twitch_comments_full_body(video_id, cursor, query_offset))
            .send()
            .await
            .context("Twitch GraphQL full request")?
            .error_for_status()
            .context("Twitch GraphQL full status")?
            .json::<Value>()
            .await
            .context("Twitch GraphQL full JSON");
    }
    Ok(value)
}

fn twitch_comments_persisted_body(
    video_id: &str,
    cursor: Option<&str>,
    query_offset: i32,
) -> Value {
    json!({
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": {
            "videoID": video_id,
            "cursor": cursor,
            "contentOffsetSeconds": if cursor.is_none() { Some(query_offset) } else { None }
        },
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"
            }
        }
    })
}

fn twitch_comments_full_body(video_id: &str, cursor: Option<&str>, query_offset: i32) -> Value {
    json!({
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": {
            "videoID": video_id,
            "cursor": cursor,
            "contentOffsetSeconds": if cursor.is_none() { Some(query_offset) } else { None }
        },
        "query": r#"
            query VideoCommentsByOffsetOrCursor($videoID: ID!, $cursor: Cursor, $contentOffsetSeconds: Int) {
              video(id: $videoID) {
                owner { id login displayName }
                comments(first: 100, after: $cursor, contentOffsetSeconds: $contentOffsetSeconds) {
                  edges {
                    cursor
                    node {
                      id
                      contentOffsetSeconds
                      createdAt
                      commenter { login displayName }
                      message {
                        userColor
                        fragments { text emote { emoteID } }
                        userBadges { setID version }
                      }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
        "#
    })
}

fn should_retry_comments_full_query(errors: Option<&Value>) -> bool {
    let Some(errors) = errors else {
        return false;
    };
    if is_twitch_integrity_error(errors) {
        return true;
    }
    errors
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item.get("message")
                    .and_then(Value::as_str)
                    .map(|message| {
                        let message = message.to_ascii_lowercase();
                        message.contains("persistedquery")
                            || message.contains("persisted query")
                            || message.contains("failed integrity check")
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn twitch_chat_parallel_workers(job: &Job, query_start: i32, max_offset: Option<i32>) -> usize {
    let Some(max_offset) = max_offset else {
        return 1;
    };
    let range_seconds = max_offset.saturating_sub(query_start);
    if range_seconds < 600 {
        return 1;
    }
    let performance = job
        .spec
        .performance
        .clone()
        .unwrap_or_default()
        .with_defaults();
    let requested = match performance.profile.unwrap_or(PerformanceProfile::Auto) {
        PerformanceProfile::Auto => 4,
        PerformanceProfile::Maximum => 8,
        PerformanceProfile::Turbo | PerformanceProfile::Custom => {
            performance.network_threads() as usize
        }
    };
    let useful_by_range = range_seconds as usize;
    requested.min(useful_by_range).clamp(1, 32)
}

fn twitch_chat_segments(
    query_start: i32,
    max_offset: i32,
    workers: usize,
    run_last_to_end: bool,
) -> Vec<TwitchChatRange> {
    if max_offset <= query_start {
        return vec![TwitchChatRange {
            start: query_start,
            end: max_offset,
            run_to_end: run_last_to_end,
        }];
    }
    let range_seconds = max_offset - query_start;
    let connection_count = (workers.max(1) as i32).min(range_seconds.max(1));
    let segment_seconds = (range_seconds as f64 / connection_count as f64).ceil() as i32;
    let mut segments = Vec::new();
    let mut start = query_start;
    let mut index = 0_i32;
    while start < max_offset {
        let end = (start + segment_seconds).min(max_offset);
        index += 1;
        segments.push(TwitchChatRange {
            start,
            end,
            run_to_end: run_last_to_end && index == connection_count,
        });
        start = end;
    }
    segments
}

fn update_twitch_segment_progress(
    progress: &Arc<Mutex<Vec<f32>>>,
    index: usize,
    range: TwitchChatRange,
    newest_timestamp: i32,
    queue: &Arc<QueueManager>,
    job_id: &str,
) {
    let span = (range.end - range.start).max(1) as f32;
    let done = if range.run_to_end {
        99.0
    } else {
        ((newest_timestamp - range.start).max(0) as f32 / span * 100.0).clamp(0.0, 99.0)
    };
    let percent = if let Ok(mut values) = progress.lock() {
        if let Some(slot) = values.get_mut(index.saturating_sub(1)) {
            *slot = (*slot).max(done);
        }
        values.iter().sum::<f32>() / values.len().max(1) as f32
    } else {
        return;
    };
    queue.set_progress(
        job_id,
        JobProgress {
            percent,
            speed: None,
            eta: None,
            current_segment: Some(format!("range {index} at {newest_timestamp}s")),
            message: Some(format!("Downloading chat replay ({percent:.1}%)")),
            ..JobProgress::default()
        },
    );
}

fn average_segment_progress(progress: &Arc<Mutex<Vec<f32>>>) -> f32 {
    progress
        .lock()
        .ok()
        .map(|values| values.iter().sum::<f32>() / values.len().max(1) as f32)
        .unwrap_or(0.0)
        .clamp(0.0, 100.0)
}

fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let minutes = total / 60;
    let seconds = total % 60;
    format!("{minutes:02}:{seconds:02}")
}

fn is_twitch_integrity_error(errors: &Value) -> bool {
    errors
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item.get("message")
                    .and_then(Value::as_str)
                    .map(|message| message.eq_ignore_ascii_case("failed integrity check"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn disperse_same_second_twitch_offsets(messages: &mut [ChatMessage]) {
    let mut groups = HashMap::<i64, Vec<usize>>::new();
    for (idx, message) in messages.iter().enumerate() {
        if message.source_platform == "twitch" {
            groups
                .entry(message.timestamp.floor() as i64)
                .or_default()
                .push(idx);
        }
    }

    for (second, mut indices) in groups {
        if indices.len() < 2 {
            continue;
        }
        indices.sort_by(|a, b| {
            let ams = messages[*a]
                .created_at
                .as_deref()
                .and_then(rfc3339_millis)
                .unwrap_or(*a as i64);
            let bms = messages[*b]
                .created_at
                .as_deref()
                .and_then(rfc3339_millis)
                .unwrap_or(*b as i64);
            ams.cmp(&bms).then_with(|| a.cmp(b))
        });
        let step = 1.0 / (indices.len() + 1) as f64;
        for (pos, idx) in indices.into_iter().enumerate() {
            messages[idx].timestamp = second as f64 + step * (pos + 1) as f64;
        }
    }
}

fn rfc3339_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn chat_query_start(job: &Job, settings: &EffectiveChatOverlaySettings) -> i32 {
    let start = parse_hms(job.spec.start.as_deref()).unwrap_or(0.0);
    let lookback = settings.message_lifetime_sec.min(30.0);
    (start - lookback).max(0.0).floor() as i32
}

fn chat_query_end(job: &Job, _settings: &EffectiveChatOverlaySettings) -> Option<i32> {
    if let Some(end) = parse_hms(job.spec.end.as_deref()) {
        return Some(end.ceil() as i32);
    }
    job.spec
        .meta
        .duration
        .map(|duration| duration.ceil() as i32)
}

struct KickChatProvider {
    ytdlp: Option<PathBuf>,
    client: reqwest::Client,
}

impl KickChatProvider {
    fn new(ytdlp: Option<PathBuf>) -> Self {
        Self {
            ytdlp,
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait]
impl ChatProvider for KickChatProvider {
    async fn download_chat(
        &self,
        job: &Job,
        settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<ChatMessage>> {
        match self
            .download_kickvod_chat(job, settings, output_json, queue, cancel.clone())
            .await
        {
            Ok(messages) => return Ok(messages),
            Err(err) => emit_log(
                queue,
                &job.id,
                &format!(
                    "Chat overlay: KickVOD replay archive unavailable, trying yt-dlp fallback: {err:#}"
                ),
            ),
        }

        emit_log(
            queue,
            &job.id,
            "Chat overlay: trying yt-dlp subtitle/chat export.",
        );
        let fallback = YtDlpChatProvider {
            ytdlp: self.ytdlp.clone(),
        };
        fallback
            .download_chat(job, settings, output_json, queue, cancel)
            .await
            .with_context(|| {
                "Kick VOD chat is unavailable for this URL. Kick did not expose archived chat subtitles or a public VOD replay endpoint. To include Kick chat, start recording from the live channel URL, for example https://kick.com/<channel>, while the stream is live."
            })
    }
}

impl KickChatProvider {
    async fn download_kickvod_chat(
        &self,
        job: &Job,
        _settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<ChatMessage>> {
        let video_id = parse_kick_video_id(&job.spec.url)
            .ok_or_else(|| anyhow!("Kick VOD id not found in URL"))?;
        let slug = match parse_kick_slug(&job.spec.url)
            .or_else(|| job.spec.meta.uploader.as_deref().map(kick_slug_from_name))
        {
            Some(slug) => slug,
            None => {
                self.find_kickvod_slug_for_video(&video_id, queue, &job.id, cancel.clone())
                    .await?
            }
        };
        let page_url = format!("https://kickvod.com/{slug}/{video_id}");

        emit_log(
            queue,
            &job.id,
            &format!("Chat overlay: checking KickVOD chat archive for {slug}/{video_id}..."),
        );
        let html = self
            .client
            .get(&page_url)
            .send()
            .await
            .with_context(|| format!("GET {page_url}"))?
            .error_for_status()
            .with_context(|| format!("GET {page_url}"))?
            .text()
            .await
            .with_context(|| format!("read {page_url}"))?;

        let archived_video_id = extract_js_string_const(&html, "vodId")
            .ok_or_else(|| anyhow!("KickVOD page did not contain vodId"))?;
        if archived_video_id != video_id {
            return Err(anyhow!(
                "KickVOD page id mismatch: expected {video_id}, got {archived_video_id}"
            ));
        }
        let archive_slug = extract_js_string_const(&html, "slug").unwrap_or(slug);
        let vod_created_at = extract_js_i64_const(&html, "vodCreatedAt")
            .ok_or_else(|| anyhow!("KickVOD page did not contain vodCreatedAt"))?;
        let vod_duration = extract_js_i64_const(&html, "vodDuration")
            .or_else(|| {
                job.spec
                    .meta
                    .duration
                    .map(|seconds| (seconds * 1000.0).ceil() as i64)
            })
            .ok_or_else(|| anyhow!("KickVOD page did not contain vodDuration"))?;

        let trim_start_sec = parse_hms(job.spec.start.as_deref()).unwrap_or(0.0);
        let trim_end_sec = parse_hms(job.spec.end.as_deref());
        let start_offset_ms = (trim_start_sec.max(0.0) * 1000.0).floor() as i64;
        let end_offset_ms = trim_end_sec
            .map(|seconds| (seconds.max(0.0) * 1000.0).ceil() as i64)
            .unwrap_or(vod_duration)
            .clamp(0, vod_duration);
        let mut start = vod_created_at + start_offset_ms.clamp(0, vod_duration);
        let end = vod_created_at + end_offset_ms;
        if start >= end {
            return Err(anyhow!("selected Kick chat range is empty"));
        }

        let total_chunks = ((end - start + 9_999) / 10_000).max(1);
        let mut chunk_index = 0_i64;
        let mut messages = Vec::new();
        let mut seen_ids = HashSet::new();
        while start < end {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            chunk_index += 1;
            let chunk_end = (start + 10_000).min(end);
            let api_url = format!(
                "https://kickvod.com/api/messages/{archive_slug}?start={start}&end={chunk_end}"
            );
            let raw_messages: Vec<Value> = self
                .client
                .get(&api_url)
                .send()
                .await
                .with_context(|| format!("GET {api_url}"))?
                .error_for_status()
                .with_context(|| format!("GET {api_url}"))?
                .json()
                .await
                .with_context(|| format!("parse {api_url}"))?;

            let before = messages.len();
            for raw in raw_messages {
                if let Some(id) = raw.get("id").and_then(Value::as_str) {
                    if !seen_ids.insert(id.to_string()) {
                        continue;
                    }
                }
                if let Some(message) = parse_kickvod_message(&raw, vod_created_at) {
                    messages.push(message);
                }
            }
            if chunk_index == 1 || chunk_index % 60 == 0 || chunk_index == total_chunks {
                emit_log(
                    queue,
                    &job.id,
                    &format!(
                        "Chat overlay: KickVOD chat chunks {chunk_index}/{total_chunks}, +{}, {} messages",
                        messages.len().saturating_sub(before),
                        messages.len()
                    ),
                );
            }
            start = chunk_end;
        }

        if messages.is_empty() {
            return Err(anyhow!(
                "KickVOD chat archive is empty for the selected range"
            ));
        }

        messages.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
        write_chat_messages(output_json, &messages)?;
        Ok(messages)
    }

    async fn find_kickvod_slug_for_video(
        &self,
        video_id: &str,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String> {
        emit_log(
            queue,
            job_id,
            "Chat overlay: Kick URL has no channel slug; searching KickVOD channels...",
        );
        let home_url = "https://kickvod.com/";
        let home = self
            .client
            .get(home_url)
            .send()
            .await
            .context("GET KickVOD channel list")?
            .error_for_status()
            .context("GET KickVOD channel list")?
            .text()
            .await
            .context("read KickVOD channel list")?;
        let slugs = extract_kickvod_channel_slugs(&home);
        if slugs.is_empty() {
            return Err(anyhow!("KickVOD channel list is empty"));
        }

        for (idx, slug) in slugs.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            if idx == 0 || idx % 10 == 0 {
                emit_log(
                    queue,
                    job_id,
                    &format!(
                        "Chat overlay: scanning KickVOD channel {}/{}...",
                        idx + 1,
                        slugs.len()
                    ),
                );
            }
            let page_url = format!("https://kickvod.com/{slug}");
            let Ok(response) = self.client.get(&page_url).send().await else {
                continue;
            };
            let Ok(response) = response.error_for_status() else {
                continue;
            };
            let Ok(page) = response.text().await else {
                continue;
            };
            if page.contains(video_id) {
                emit_log(
                    queue,
                    job_id,
                    &format!("Chat overlay: KickVOD VOD found under channel {slug}."),
                );
                return Ok(slug.clone());
            }
        }

        Err(anyhow!(
            "Kick channel slug not found. Use a URL with channel name, for example https://kick.com/<channel>/videos/{video_id}, or a KickVOD URL https://kickvod.com/<channel>/{video_id}."
        ))
    }
}

fn parse_kick_video_id(url: &str) -> Option<String> {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    for segment in without_query.split('/') {
        let candidate = segment.trim();
        if is_uuid_like(candidate) {
            return Some(candidate.to_ascii_lowercase());
        }
    }
    None
}

fn parse_kick_slug(url: &str) -> Option<String> {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let parts = without_query
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let host_index = parts
        .iter()
        .position(|part| {
            part.eq_ignore_ascii_case("kick.com") || part.eq_ignore_ascii_case("www.kick.com")
        })
        .or_else(|| {
            parts.iter().position(|part| {
                part.eq_ignore_ascii_case("kickvod.com")
                    || part.eq_ignore_ascii_case("www.kickvod.com")
            })
        });
    let first_path = host_index.map(|idx| idx + 1).unwrap_or(0);
    let slug = parts.get(first_path)?;
    if slug.eq_ignore_ascii_case("video")
        || slug.eq_ignore_ascii_case("videos")
        || slug.eq_ignore_ascii_case("categories")
        || slug.eq_ignore_ascii_case("search")
        || is_uuid_like(slug)
    {
        None
    } else {
        Some(kick_slug_from_name(slug))
    }
}

fn kick_slug_from_name(name: &str) -> String {
    name.trim()
        .trim_matches('/')
        .to_ascii_lowercase()
        .replace(' ', "")
}

fn is_uuid_like(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    let lengths = [8, 4, 4, 4, 12];
    parts.len() == lengths.len()
        && parts
            .iter()
            .zip(lengths)
            .all(|(part, len)| part.len() == len && part.chars().all(|ch| ch.is_ascii_hexdigit()))
}

fn extract_js_string_const(html: &str, name: &str) -> Option<String> {
    let marker = format!("const {name} = \"");
    let start = html.find(&marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_js_i64_const(html: &str, name: &str) -> Option<i64> {
    let marker = format!("const {name} = ");
    let start = html.find(&marker)? + marker.len();
    let rest = &html[start..];
    let digits = rest
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    digits.parse().ok()
}

fn extract_kickvod_channel_slugs(html: &str) -> Vec<String> {
    let mut slugs = Vec::new();
    let mut rest = html;
    let marker = "\"href\":\"/";
    while let Some(idx) = rest.find(marker) {
        rest = &rest[idx + marker.len()..];
        let Some(end) = rest.find('"') else {
            break;
        };
        let slug = &rest[..end];
        if !slug.is_empty()
            && !slug.contains('/')
            && !slug.contains('\\')
            && !slugs.iter().any(|item| item == slug)
        {
            slugs.push(slug.to_string());
        }
        rest = &rest[end..];
    }
    slugs
}

fn parse_kickvod_message(raw: &Value, vod_created_at_ms: i64) -> Option<ChatMessage> {
    let message_type = raw.get("type").and_then(Value::as_str).unwrap_or("message");
    let created_at = raw.get("createdAt").and_then(Value::as_str)?;
    let created_at_ms = DateTime::parse_from_rfc3339(created_at)
        .ok()?
        .timestamp_millis();
    let timestamp = (created_at_ms - vod_created_at_ms) as f64 / 1000.0;
    if timestamp < 0.0 {
        return None;
    }

    let username = raw
        .get("slug")
        .or_else(|| raw.get("username"))
        .and_then(Value::as_str)
        .unwrap_or("kick")
        .to_string();
    let display_name = raw
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or(&username)
        .to_string();
    let mut content = raw
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if message_type == "reply" {
        if let Ok(reply) = serde_json::from_str::<Value>(&content) {
            content = reply
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
        }
    } else if message_type != "message" {
        content = kick_event_text(message_type, &content)?;
    }

    if content.trim().is_empty() {
        return None;
    }

    Some(ChatMessage {
        timestamp,
        created_at: Some(created_at.to_string()),
        username,
        display_name,
        user_color: raw.get("color").and_then(Value::as_str).map(str::to_string),
        badges: parse_kick_badges(raw.get("badges").and_then(Value::as_str).unwrap_or("[]")),
        fragments: parse_kick_fragments(&content),
        source_platform: "kick".to_string(),
    })
}

fn kick_event_text(message_type: &str, content: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(content).ok()?;
    match message_type {
        "sub" => {
            let username = value
                .get("username")
                .and_then(Value::as_str)
                .unwrap_or("Someone");
            let months = value.get("months").and_then(Value::as_i64).unwrap_or(1);
            Some(format!("{username} subscribed for {months} month(s)."))
        }
        "gift" => {
            let from = value
                .get("from")
                .and_then(Value::as_str)
                .unwrap_or("Someone");
            let count = value
                .get("to")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(1);
            Some(format!("{from} gifted {count} sub(s)."))
        }
        "host" => {
            let username = value
                .get("username")
                .and_then(Value::as_str)
                .unwrap_or("Someone");
            let viewers = value.get("viewers").and_then(Value::as_i64).unwrap_or(0);
            Some(format!("{username} hosted with {viewers} viewer(s)."))
        }
        _ => None,
    }
}

fn parse_kick_badges(raw: &str) -> Vec<ChatBadge> {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let id = item
                .get("type")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)?
                .to_string();
            Some(ChatBadge {
                provider: "kick".to_string(),
                id,
                version: item
                    .get("count")
                    .and_then(Value::as_i64)
                    .map(|count| count.to_string()),
                url: None,
                title: item.get("text").and_then(Value::as_str).map(str::to_string),
            })
        })
        .collect()
}

fn parse_kick_fragments(content: &str) -> Vec<ChatFragment> {
    let mut fragments = Vec::new();
    let mut rest = content;
    loop {
        let Some(start) = rest.find("[emote:") else {
            push_text_fragment(&mut fragments, rest);
            break;
        };
        push_text_fragment(&mut fragments, &rest[..start]);
        let emote_rest = &rest[start..];
        let Some(end) = emote_rest.find(']') else {
            push_text_fragment(&mut fragments, emote_rest);
            break;
        };
        let token = &emote_rest[1..end];
        let parts = token.splitn(3, ':').collect::<Vec<_>>();
        if parts.len() == 3 && parts[0] == "emote" && !parts[1].is_empty() {
            fragments.push(ChatFragment::Emote {
                provider: "kick".to_string(),
                id: parts[1].to_string(),
                url: format!("https://files.kick.com/emotes/{}/fullsize", parts[1]),
                text: Some(parts[2].to_string()),
                zero_width: false,
            });
        } else {
            push_text_fragment(&mut fragments, &emote_rest[..=end]);
        }
        rest = &emote_rest[end + 1..];
    }
    if fragments.is_empty() {
        fragments.push(ChatFragment::Text {
            text: content.to_string(),
        });
    }
    fragments
}

fn push_text_fragment(fragments: &mut Vec<ChatFragment>, text: &str) {
    if !text.is_empty() {
        fragments.push(ChatFragment::Text {
            text: text.to_string(),
        });
    }
}

struct YtDlpChatProvider {
    ytdlp: Option<PathBuf>,
}

#[async_trait]
impl ChatProvider for YtDlpChatProvider {
    async fn download_chat(
        &self,
        job: &Job,
        _settings: &EffectiveChatOverlaySettings,
        output_json: &Path,
        queue: &Arc<QueueManager>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<ChatMessage>> {
        let ytdlp = self
            .ytdlp
            .as_ref()
            .ok_or_else(|| anyhow!("yt-dlp.exe not found - chat fallback unavailable"))?;
        let parent = output_json.parent().unwrap_or_else(|| Path::new("."));
        let template = parent.join("chat_export.%(ext)s");
        let mut cmd = Command::new(ytdlp);
        cmd.kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .args([
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                "live_chat,chat,all",
                "--sub-format",
                "json/vtt/best",
                "-o",
            ])
            .arg(&template)
            .arg(&job.spec.url);

        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        emit_log(
            queue,
            &job.id,
            "Chat overlay: running yt-dlp chat export fallback...",
        );
        let mut child = cmd.spawn().context("spawn yt-dlp chat export")?;
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            match child.try_wait()? {
                Some(status) => {
                    if !status.success() {
                        return Err(anyhow!("yt-dlp chat export exited with {status}"));
                    }
                    break;
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
            }
        }

        for entry in std::fs::read_dir(parent)? {
            let path = entry?.path();
            let is_json = path.extension().and_then(|s| s.to_str()) == Some("json");
            if !is_json || path == output_json {
                continue;
            }
            if let Ok(messages) = read_chat_messages(&path) {
                write_chat_messages(output_json, &messages)?;
                return Ok(messages);
            }
        }

        Err(anyhow!("yt-dlp did not produce a unified chat JSON file"))
    }
}

fn parse_twitch_video_id(url: &str) -> Option<String> {
    let lowered = url.to_ascii_lowercase();
    for marker in ["/videos/", "/video/", "/v/"] {
        if let Some(idx) = lowered.find(marker) {
            let raw = &url[idx + marker.len()..];
            let id: String = raw.chars().take_while(|ch| ch.is_ascii_digit()).collect();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    let id: String = url
        .chars()
        .skip_while(|ch| !ch.is_ascii_digit())
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if id.len() >= 6 {
        Some(id)
    } else {
        None
    }
}

fn parse_twitch_message(node: &Value) -> Option<ChatMessage> {
    let timestamp = node.get("contentOffsetSeconds")?.as_f64()?;
    let created_at = node
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_string);
    let username = node
        .pointer("/commenter/login")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let display_name = node
        .pointer("/commenter/displayName")
        .and_then(Value::as_str)
        .unwrap_or(&username)
        .to_string();
    let user_color = node
        .pointer("/message/userColor")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut badges = Vec::new();
    if let Some(raw_badges) = node
        .pointer("/message/userBadges")
        .and_then(Value::as_array)
    {
        for badge in raw_badges {
            let id = badge
                .get("setID")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            badges.push(ChatBadge {
                provider: "twitch".to_string(),
                id,
                version: badge
                    .get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                url: None,
                title: None,
            });
        }
    }

    let mut fragments = Vec::new();
    if let Some(raw_fragments) = node.pointer("/message/fragments").and_then(Value::as_array) {
        for fragment in raw_fragments {
            let text = fragment
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if let Some(emote_id) = fragment.pointer("/emote/emoteID").and_then(Value::as_str) {
                fragments.push(ChatFragment::Emote {
                    provider: "twitch".to_string(),
                    id: emote_id.to_string(),
                    url: format!(
                        "https://static-cdn.jtvnw.net/emoticons/v2/{emote_id}/default/dark/2.0"
                    ),
                    text: Some(text),
                    zero_width: false,
                });
            } else if !text.is_empty() {
                fragments.push(ChatFragment::Text { text });
            }
        }
    }

    Some(ChatMessage {
        timestamp,
        created_at,
        username,
        display_name,
        user_color,
        badges,
        fragments,
        source_platform: "twitch".to_string(),
    })
}

async fn apply_twitch_badge_urls(
    client: &reqwest::Client,
    channel_id: &str,
    messages: &mut [ChatMessage],
) {
    let mut urls = HashMap::<String, (String, String)>::new();
    for endpoint in [
        "https://badges.twitch.tv/v1/badges/global/display".to_string(),
        format!("https://badges.twitch.tv/v1/badges/channels/{channel_id}/display"),
    ] {
        if let Ok(response) = client.get(&endpoint).send().await {
            if let Ok(value) = response.json::<Value>().await {
                if let Some(sets) = value.get("badge_sets").and_then(Value::as_object) {
                    for (set_id, set) in sets {
                        if let Some(versions) = set.get("versions").and_then(Value::as_object) {
                            for (version, meta) in versions {
                                if let Some(url) = meta.get("image_url_2x").and_then(Value::as_str)
                                {
                                    let title = meta
                                        .get("title")
                                        .and_then(Value::as_str)
                                        .unwrap_or(set_id)
                                        .to_string();
                                    urls.insert(
                                        format!("{set_id}:{version}"),
                                        (url.to_string(), title),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    for message in messages {
        for badge in &mut message.badges {
            let version = badge.version.as_deref().unwrap_or("1");
            if let Some((url, title)) = urls.get(&format!("{}:{version}", badge.id)) {
                badge.url = Some(url.clone());
                badge.title = Some(title.clone());
            }
        }
    }
}

#[derive(Default)]
struct ThirdPartyEmoteIndex {
    by_code: HashMap<String, IndexedEmote>,
}

struct IndexedEmote {
    priority: u8,
    fragment: ChatFragment,
}

impl ThirdPartyEmoteIndex {
    fn insert(
        &mut self,
        priority: u8,
        provider: &str,
        id: &str,
        code: &str,
        url: String,
        zero_width: bool,
    ) -> bool {
        if code.trim().is_empty() || id.trim().is_empty() || url.trim().is_empty() {
            return false;
        }
        let next = IndexedEmote {
            priority,
            fragment: ChatFragment::Emote {
                provider: provider.to_string(),
                id: id.to_string(),
                url,
                text: Some(code.to_string()),
                zero_width,
            },
        };
        match self.by_code.get(code) {
            Some(existing) if existing.priority <= priority => false,
            _ => {
                self.by_code.insert(code.to_string(), next);
                true
            }
        }
    }

    fn rewrite(&self, messages: &mut [ChatMessage]) {
        for message in messages {
            let mut rewritten = Vec::new();
            for fragment in std::mem::take(&mut message.fragments) {
                match fragment {
                    ChatFragment::Text { text } => {
                        for part in split_words_preserve_spaces(&text) {
                            if part.trim().is_empty() {
                                rewritten.push(ChatFragment::Text { text: part });
                            } else if let Some(emote) = self.by_code.get(&part) {
                                rewritten.push(emote.fragment.clone());
                            } else {
                                rewritten.push(ChatFragment::Text { text: part });
                            }
                        }
                    }
                    other => rewritten.push(other),
                }
            }
            message.fragments = rewritten;
        }
    }
}

async fn apply_third_party_emotes(
    client: &reqwest::Client,
    channel_id: &str,
    settings: &EffectiveChatOverlaySettings,
    messages: &mut [ChatMessage],
    queue: &Arc<QueueManager>,
    job_id: &str,
) {
    let mut index = ThirdPartyEmoteIndex::default();
    let mut stats = Vec::new();
    if settings.show_bttv {
        stats.push((
            "BTTV",
            load_bttv(client, channel_id, &mut index, queue, job_id).await,
        ));
    }
    if settings.show_ffz {
        stats.push((
            "FFZ",
            load_ffz(client, channel_id, &mut index, queue, job_id).await,
        ));
    }
    if settings.show_7tv {
        stats.push((
            "7TV",
            load_7tv(client, channel_id, &mut index, queue, job_id).await,
        ));
    }
    let used_codes = messages
        .iter()
        .flat_map(|message| message.fragments.iter())
        .filter_map(|fragment| match fragment {
            ChatFragment::Text { text } => Some(text.as_str()),
            ChatFragment::Emote { .. } => None,
        })
        .flat_map(split_words_preserve_spaces)
        .filter(|part| index.by_code.contains_key(part))
        .collect::<HashSet<_>>()
        .len();
    emit_log(
        queue,
        job_id,
        &format!(
            "Chat overlay: third-party emote index loaded ({} codes, {} used; {})",
            index.by_code.len(),
            used_codes,
            stats
                .into_iter()
                .map(|(provider, count)| format!("{provider} {count}"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    );
    index.rewrite(messages);
}

async fn load_bttv(
    client: &reqwest::Client,
    channel_id: &str,
    index: &mut ThirdPartyEmoteIndex,
    queue: &Arc<QueueManager>,
    job_id: &str,
) -> usize {
    let mut inserted = 0;
    match fetch_json(client, "https://api.betterttv.net/3/cached/emotes/global").await {
        Ok(value) => {
            if let Some(arr) = value.as_array() {
                for item in arr {
                    inserted += insert_bttv(item, index, 60) as usize;
                }
            }
        }
        Err(err) => {
            emit_log(
                queue,
                job_id,
                &format!("!! Chat overlay: BetterTTV global metadata unavailable: {err:#}"),
            );
        }
    }
    match fetch_json(
        client,
        &format!("https://api.betterttv.net/3/cached/users/twitch/{channel_id}"),
    )
    .await
    {
        Ok(value) => {
            for key in ["channelEmotes", "sharedEmotes"] {
                if let Some(arr) = value.get(key).and_then(Value::as_array) {
                    for item in arr {
                        inserted += insert_bttv(item, index, 20) as usize;
                    }
                }
            }
        }
        Err(err) => {
            emit_log(
                queue,
                job_id,
                &format!("!! Chat overlay: BetterTTV channel metadata unavailable: {err:#}"),
            );
        }
    }
    inserted
}

fn insert_bttv(item: &Value, index: &mut ThirdPartyEmoteIndex, priority: u8) -> bool {
    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return false;
    };
    let Some(code) = item.get("code").and_then(Value::as_str) else {
        return false;
    };
    const BTTV_ZERO_WIDTH: &[&str] = &[
        "SoSnowy",
        "IceCold",
        "SantaHat",
        "TopHat",
        "ReinDeer",
        "CandyCane",
        "cvMask",
        "cvHazmat",
    ];
    index.insert(
        priority,
        "bttv",
        id,
        code,
        format!("https://cdn.betterttv.net/emote/{id}/2x"),
        BTTV_ZERO_WIDTH.contains(&code),
    )
}

async fn load_ffz(
    client: &reqwest::Client,
    channel_id: &str,
    index: &mut ThirdPartyEmoteIndex,
    queue: &Arc<QueueManager>,
    job_id: &str,
) -> usize {
    let mut inserted = 0;
    for (url, priority) in [
        (
            "https://api.betterttv.net/3/cached/frankerfacez/emotes/global".to_string(),
            70_u8,
        ),
        (
            format!("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/{channel_id}"),
            30_u8,
        ),
    ] {
        match fetch_json(client, &url).await {
            Ok(value) => {
                let emotes = value
                    .as_array()
                    .cloned()
                    .or_else(|| value.get("emotes").and_then(Value::as_array).cloned())
                    .unwrap_or_default();
                for emote in emotes {
                    inserted += insert_ffz(&emote, index, priority) as usize;
                }
            }
            Err(err) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Chat overlay: FFZ cached metadata unavailable ({url}): {err:#}"),
                );
            }
        }
    }
    if inserted == 0 {
        inserted += load_ffz_legacy(client, channel_id, index, queue, job_id).await;
    }
    inserted
}

fn insert_ffz(item: &Value, index: &mut ThirdPartyEmoteIndex, priority: u8) -> bool {
    let Some(id_value) = item.get("id") else {
        return false;
    };
    let id = id_value
        .as_str()
        .map(str::to_string)
        .or_else(|| id_value.as_i64().map(|value| value.to_string()))
        .unwrap_or_default();
    let Some(code) = item
        .get("code")
        .or_else(|| item.get("name"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    let animated = item
        .get("animated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let url = if animated {
        format!("https://cdn.betterttv.net/frankerfacez_emote/{id}/animated/2")
    } else {
        format!("https://cdn.betterttv.net/frankerfacez_emote/{id}/2")
    };
    index.insert(priority, "ffz", &id, code, url, false)
}

#[allow(dead_code)]
async fn load_ffz_legacy(
    client: &reqwest::Client,
    channel_id: &str,
    index: &mut ThirdPartyEmoteIndex,
    queue: &Arc<QueueManager>,
    job_id: &str,
) -> usize {
    let mut inserted = 0;
    for (url, priority) in [
        (
            "https://api.frankerfacez.com/v1/set/global".to_string(),
            70_u8,
        ),
        (
            format!("https://api.frankerfacez.com/v1/room/id/{channel_id}"),
            30_u8,
        ),
    ] {
        match fetch_json(client, &url).await {
            Ok(value) => {
                if let Some(sets) = value.get("sets").and_then(Value::as_object) {
                    for set in sets.values() {
                        if let Some(emotes) = set.get("emoticons").and_then(Value::as_array) {
                            for emote in emotes {
                                inserted += insert_ffz_legacy(emote, index, priority) as usize;
                            }
                        }
                    }
                }
            }
            Err(err) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Chat overlay: FFZ legacy metadata unavailable ({url}): {err:#}"),
                );
            }
        }
    }
    inserted
}

fn insert_ffz_legacy(item: &Value, index: &mut ThirdPartyEmoteIndex, priority: u8) -> bool {
    let Some(id) = item.get("id").and_then(Value::as_i64) else {
        return false;
    };
    let Some(name) = item.get("name").and_then(Value::as_str) else {
        return false;
    };
    let url = item
        .pointer("/urls/2")
        .or_else(|| item.pointer("/urls/1"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.is_empty() {
        return false;
    }
    let normalized = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    };
    index.insert(priority, "ffz", &id.to_string(), name, normalized, false)
}

async fn load_7tv(
    client: &reqwest::Client,
    channel_id: &str,
    index: &mut ThirdPartyEmoteIndex,
    queue: &Arc<QueueManager>,
    job_id: &str,
) -> usize {
    let mut inserted = 0;
    for (url, priority) in [
        ("https://7tv.io/v3/emote-sets/global".to_string(), 50_u8),
        (
            format!("https://7tv.io/v3/users/twitch/{channel_id}"),
            10_u8,
        ),
    ] {
        match fetch_json(client, &url).await {
            Ok(value) => {
                let emotes = value
                    .get("emotes")
                    .and_then(Value::as_array)
                    .cloned()
                    .or_else(|| {
                        value
                            .pointer("/emote_set/emotes")
                            .and_then(Value::as_array)
                            .cloned()
                    })
                    .unwrap_or_default();
                for emote in emotes {
                    let Some(id) = emote.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(name) = emote.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    let flags = emote
                        .pointer("/data/flags")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    const STV_PRIVATE: u64 = 1 << 0;
                    const STV_ZERO_WIDTH: u64 = 1 << 8;
                    const STV_CONTENT_TWITCH_DISALLOWED: u64 = 1 << 24;
                    if flags & (STV_PRIVATE | STV_CONTENT_TWITCH_DISALLOWED) != 0 {
                        continue;
                    }
                    if !stv_has_webp(&emote) {
                        continue;
                    }
                    inserted += index.insert(
                        priority,
                        "7tv",
                        id,
                        name,
                        format!("https://cdn.7tv.app/emote/{id}/2x.webp"),
                        flags & STV_ZERO_WIDTH != 0,
                    ) as usize;
                }
            }
            Err(err) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Chat overlay: 7TV metadata unavailable ({url}): {err:#}"),
                );
            }
        }
    }
    inserted
}

fn stv_has_webp(emote: &Value) -> bool {
    emote
        .pointer("/data/host/files")
        .and_then(Value::as_array)
        .map(|files| {
            files.iter().any(|file| {
                file.get("format")
                    .and_then(Value::as_str)
                    .map(|format| format.eq_ignore_ascii_case("webp"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(true)
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<Value> {
    client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("GET {url}"))?
        .json()
        .await
        .with_context(|| format!("parse {url}"))
}

fn split_words_preserve_spaces(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut last_space: Option<bool> = None;
    for ch in text.chars() {
        let is_space = ch.is_whitespace();
        if let Some(prev) = last_space {
            if prev != is_space && !buf.is_empty() {
                out.push(std::mem::take(&mut buf));
            }
        }
        buf.push(ch);
        last_space = Some(is_space);
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        chat_query_end, chat_query_start, disperse_same_second_twitch_offsets, insert_ffz,
        is_twitch_integrity_error, split_words_preserve_spaces, stv_has_webp, twitch_chat_segments,
        twitch_comments_persisted_body, ThirdPartyEmoteIndex,
    };
    use crate::chat_overlay::model::{ChatFragment, ChatMessage};
    use crate::chat_overlay::settings::EffectiveChatOverlaySettings;
    use serde_json::json;

    #[test]
    fn third_party_emote_priority_prefers_channel_7tv() {
        let mut index = ThirdPartyEmoteIndex::default();
        assert!(index.insert(
            60,
            "bttv",
            "bttv-global",
            "OMEGALUL",
            "https://cdn.betterttv.net/emote/bttv-global/2x".to_string(),
            false,
        ));
        assert!(index.insert(
            10,
            "7tv",
            "7tv-channel",
            "OMEGALUL",
            "https://cdn.7tv.app/emote/7tv-channel/2x.webp".to_string(),
            true,
        ));

        let mut messages = vec![ChatMessage {
            timestamp: 1.0,
            created_at: None,
            username: "user".to_string(),
            display_name: "User".to_string(),
            user_color: None,
            badges: Vec::new(),
            fragments: vec![ChatFragment::Text {
                text: "hello OMEGALUL".to_string(),
            }],
            source_platform: "twitch".to_string(),
        }];
        index.rewrite(&mut messages);

        assert!(matches!(
            &messages[0].fragments[2],
            ChatFragment::Emote {
                provider,
                id,
                zero_width: true,
                ..
            } if provider == "7tv" && id == "7tv-channel"
        ));
    }

    #[test]
    fn stv_webp_filter_requires_webp_when_files_are_known() {
        assert!(stv_has_webp(&json!({
            "data": { "host": { "files": [{ "format": "WEBP" }] } }
        })));
        assert!(!stv_has_webp(&json!({
            "data": { "host": { "files": [{ "format": "avif" }] } }
        })));
    }

    #[test]
    fn split_words_preserves_spacing_and_word_boundaries() {
        assert_eq!(
            split_words_preserve_spaces("hello  OMEGALUL"),
            vec!["hello", "  ", "OMEGALUL"]
        );
    }

    #[test]
    fn twitch_integrity_error_is_detected() {
        let errors = json!([{
            "message": "failed integrity check",
            "path": ["video", "comments"]
        }]);
        assert!(is_twitch_integrity_error(&errors));
    }

    #[test]
    fn twitch_same_second_messages_are_dispersed_deterministically() {
        let mut messages = vec![
            ChatMessage {
                timestamp: 10.0,
                created_at: Some("2026-05-12T10:00:00.300Z".to_string()),
                username: "b".to_string(),
                display_name: "B".to_string(),
                user_color: None,
                badges: Vec::new(),
                fragments: vec![ChatFragment::Text {
                    text: "second".to_string(),
                }],
                source_platform: "twitch".to_string(),
            },
            ChatMessage {
                timestamp: 10.0,
                created_at: Some("2026-05-12T10:00:00.100Z".to_string()),
                username: "a".to_string(),
                display_name: "A".to_string(),
                user_color: None,
                badges: Vec::new(),
                fragments: vec![ChatFragment::Text {
                    text: "first".to_string(),
                }],
                source_platform: "twitch".to_string(),
            },
        ];

        disperse_same_second_twitch_offsets(&mut messages);

        assert_eq!(messages[1].timestamp, 10.0 + 1.0 / 3.0);
        assert_eq!(messages[0].timestamp, 10.0 + 2.0 / 3.0);
    }

    #[test]
    fn twitch_parallel_segments_cover_full_range() {
        let segments = twitch_chat_segments(0, 600, 4, true);
        assert_eq!(segments.first().unwrap().start, 0);
        assert_eq!(segments.last().unwrap().end, 600);
        assert!(segments.last().unwrap().run_to_end);
        assert!(segments.windows(2).all(|pair| pair[0].end == pair[1].start));
        assert!(segments.iter().all(|range| range.end > range.start));
    }

    #[test]
    fn twitch_chat_query_range_does_not_expand_by_full_message_lifetime() {
        let settings = EffectiveChatOverlaySettings::from(
            crate::jobs::types::ChatOverlaySettings {
                message_lifetime_sec: Some(86400.0),
                ..crate::jobs::types::ChatOverlaySettings::default()
            }
            .with_defaults(),
        );
        let mut job = crate::jobs::types::Job {
            id: "job".to_string(),
            spec: crate::jobs::types::JobSpec {
                url: "https://www.twitch.tv/videos/123".to_string(),
                chat_source_url: None,
                name: "test".to_string(),
                directory: ".".to_string(),
                job_kind: None,
                mode: crate::jobs::types::Mode::Vod,
                download_kind: None,
                start: Some("00:10:00".to_string()),
                end: Some("00:20:00".to_string()),
                fragments: Vec::new(),
                split: false,
                split_interval_minutes: None,
                quality: None,
                quality_has_audio: None,
                quality_has_video: None,
                quality_height: None,
                unmute_video: false,
                proxy: Default::default(),
                chat_overlay: None,
                performance: None,
                blur_zones: Vec::new(),
                binaries_dir: None,
                meta: Default::default(),
            },
            status: crate::jobs::types::JobStatus::Queued,
            progress: Default::default(),
            created_at: 0,
            started_at: None,
            finished_at: None,
            error: None,
            output_path: None,
        };

        assert_eq!(chat_query_start(&job, &settings), 570);
        assert_eq!(chat_query_end(&job, &settings), Some(1200));
        job.spec.end = None;
        job.spec.meta.duration = Some(3600.0);
        assert_eq!(chat_query_end(&job, &settings), Some(3600));
    }

    #[test]
    fn twitch_persisted_comment_query_uses_offset_or_cursor() {
        let first = twitch_comments_persisted_body("123", None, 42);
        assert_eq!(first["operationName"], "VideoCommentsByOffsetOrCursor");
        assert_eq!(first["variables"]["contentOffsetSeconds"], 42);
        assert!(first["variables"]["cursor"].is_null());
        assert_eq!(
            first["extensions"]["persistedQuery"]["sha256Hash"],
            "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"
        );

        let cursor = twitch_comments_persisted_body("123", Some("abc"), 42);
        assert_eq!(cursor["variables"]["cursor"], "abc");
        assert!(cursor["variables"]["contentOffsetSeconds"].is_null());
    }

    #[test]
    fn ffz_cached_metadata_uses_bttv_cdn_templates() {
        let mut index = ThirdPartyEmoteIndex::default();
        assert!(insert_ffz(
            &json!({"id": 55, "code": "PepoDance", "animated": true}),
            &mut index,
            10,
        ));
        let fragment = &index.by_code.get("PepoDance").unwrap().fragment;
        assert!(matches!(
            fragment,
            ChatFragment::Emote { provider, id, url, .. }
                if provider == "ffz"
                    && id == "55"
                    && url == "https://cdn.betterttv.net/frankerfacez_emote/55/animated/2"
        ));
    }
}
