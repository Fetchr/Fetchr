use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::binaries::{resolve_binary, YTDLP};
use crate::chat_overlay::emit_log;
use crate::chat_overlay::model::{write_chat_messages, ChatBadge, ChatFragment, ChatMessage};
use crate::jobs::queue::QueueManager;
use crate::jobs::types::Job;

const PUSHER_KEY: &str = "32cbd69e4b950bf97679";

pub struct KickLiveChatRecorder {
    stop: Arc<AtomicBool>,
    output_path: PathBuf,
    task: JoinHandle<Result<KickLiveChatStats>>,
}

#[derive(Debug, Clone)]
pub struct KickLiveChatStats {
    pub subscribed: bool,
    pub raw_events: usize,
    pub parsed_messages: usize,
    pub output_path: PathBuf,
}

impl KickLiveChatRecorder {
    pub async fn stop_and_wait(
        self,
        queue: &Arc<QueueManager>,
        job_id: &str,
    ) -> Result<KickLiveChatStats> {
        self.stop.store(true, Ordering::SeqCst);
        match tokio::time::timeout(Duration::from_secs(8), self.task).await {
            Ok(Ok(Ok(stats))) => {
                emit_log(
                    queue,
                    job_id,
                    &format!(
                        "Kick live chat recorder: captured {} messages (raw events {}, subscribed {}) to {}",
                        stats.parsed_messages,
                        stats.raw_events,
                        stats.subscribed,
                        stats.output_path.display()
                    ),
                );
                Ok(stats)
            }
            Ok(Ok(Err(err))) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Kick live chat recorder stopped with error: {err:#}"),
                );
                Err(err)
            }
            Ok(Err(err)) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Kick live chat recorder task failed: {err}"),
                );
                Err(anyhow!("Kick live chat recorder task failed: {err}"))
            }
            Err(_) => {
                emit_log(
                    queue,
                    job_id,
                    "!! Kick live chat recorder did not stop within timeout.",
                );
                Err(anyhow!(
                    "Kick live chat recorder did not stop within timeout for {}",
                    self.output_path.display()
                ))
            }
        }
    }
}

pub async fn start_kick_live_chat_recorder(
    queue: Arc<QueueManager>,
    job: &Job,
    bin_dir: Option<&Path>,
    output_path: PathBuf,
    cancel: Arc<AtomicBool>,
) -> Result<KickLiveChatRecorder> {
    let slug = parse_kick_slug(&job.spec.url)
        .or_else(|| job.spec.meta.uploader.as_deref().map(kick_slug_from_name))
        .ok_or_else(|| anyhow!("Kick channel slug not found in URL"))?;
    let ytdlp = resolve_binary(YTDLP, bin_dir);
    let channel = match ytdlp.as_deref() {
        Some(path) => match fetch_ytdlp_channel_dump(path, &slug).await {
            Ok(channel) => channel,
            Err(err) => {
                emit_log(
                    &queue,
                    &job.id,
                    &format!(
                        "!! Kick live chat recorder: yt-dlp channel dump failed, trying direct API: {err:#}"
                    ),
                );
                let metadata = fetch_ytdlp_metadata(path, &job.spec.url).await.ok();
                let cookie = metadata.as_ref().and_then(extract_kick_cookie);
                let user_agent = metadata
                    .as_ref()
                    .and_then(extract_kick_user_agent)
                    .unwrap_or_else(default_user_agent);
                fetch_kick_channel_json(&slug, cookie.as_deref(), &user_agent).await?
            }
        },
        None => fetch_kick_channel_json(&slug, None, &default_user_agent()).await?,
    };
    let chatroom_id = find_chatroom_id(&channel)
        .ok_or_else(|| anyhow!("Kick channel API did not contain chatroom id"))?;

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    if output_path.exists() {
        std::fs::remove_file(&output_path)
            .with_context(|| format!("remove stale {}", output_path.display()))?;
    }
    emit_log(
        &queue,
        &job.id,
        &format!(
            "Kick live chat recorder: connected channel {slug}, chatroom {chatroom_id}; writing {}",
            output_path.display()
        ),
    );

    let stop = Arc::new(AtomicBool::new(false));
    let task_stop = stop.clone();
    let job_id = job.id.clone();
    let task_path = output_path.clone();
    let started_at = Instant::now();
    let (subscription_tx, subscription_rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        record_kick_chat(
            queue,
            job_id,
            chatroom_id,
            task_path,
            task_stop,
            cancel,
            started_at,
            subscription_tx,
        )
        .await
    });

    match tokio::time::timeout(Duration::from_secs(12), subscription_rx).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(err))) => {
            stop.store(true, Ordering::SeqCst);
            return Err(err.context("Kick live chat recorder subscription failed"));
        }
        Ok(Err(_)) => {
            stop.store(true, Ordering::SeqCst);
            return Err(anyhow!(
                "Kick live chat recorder ended before subscription confirmation"
            ));
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            return Err(anyhow!(
                "Kick live chat recorder did not confirm Pusher subscription within 12s"
            ));
        }
    }

    Ok(KickLiveChatRecorder {
        stop,
        output_path,
        task,
    })
}

pub fn is_kick_live_channel_url(url: &str) -> bool {
    let lowered = url.to_ascii_lowercase();
    lowered.contains("kick.com")
        && !lowered.contains("/videos/")
        && !lowered.contains("/video/")
        && !lowered.contains("kickvod.com")
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
        .replace('_', "-")
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

async fn fetch_ytdlp_metadata(ytdlp: &Path, url: &str) -> Result<Value> {
    let mut cmd = Command::new(ytdlp);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .args(["-J", "--no-warnings", "--no-check-certificates"])
        .arg(url);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }

    let output = cmd.output().await.context("run yt-dlp metadata")?;
    if !output.status.success() {
        return Err(anyhow!("yt-dlp metadata exited with {}", output.status));
    }
    serde_json::from_slice(&output.stdout).context("parse yt-dlp metadata")
}

async fn fetch_ytdlp_channel_dump(ytdlp: &Path, slug: &str) -> Result<Value> {
    let channel_url = format!("https://kick.com/{slug}");
    let mut cmd = Command::new(ytdlp);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .args([
            "--dump-pages",
            "--skip-download",
            "--no-warnings",
            "--no-check-certificates",
        ])
        .arg(&channel_url);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }

    let output = cmd.output().await.context("run yt-dlp channel dump")?;
    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    combined.push('\n');
    combined.push_str(&String::from_utf8_lossy(&output.stderr));

    for line in combined.lines().map(str::trim) {
        if line.len() < 16
            || !line
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=')
        {
            continue;
        }
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(line) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if find_chatroom_id(&value).is_some() {
            return Ok(value);
        }
    }

    Err(anyhow!(
        "yt-dlp channel dump did not include a Kick channel JSON with chatroom id"
    ))
}

fn extract_kick_cookie(metadata: &Value) -> Option<String> {
    metadata
        .pointer("/requested_downloads/0/cookies")
        .or_else(|| metadata.pointer("/formats/0/cookies"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn extract_kick_user_agent(metadata: &Value) -> Option<String> {
    metadata
        .pointer("/http_headers/User-Agent")
        .or_else(|| metadata.pointer("/formats/0/http_headers/User-Agent"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn default_user_agent() -> String {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36".to_string()
}

async fn fetch_kick_channel_json(
    slug: &str,
    cookie: Option<&str>,
    user_agent: &str,
) -> Result<Value> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .build()
        .context("build Kick HTTP client")?;
    let mut last_error = None;
    for endpoint in [
        format!("https://kick.com/api/v2/channels/{slug}"),
        format!("https://kick.com/api/v1/channels/{slug}"),
    ] {
        let mut request = client
            .get(&endpoint)
            .header("Accept", "application/json, text/plain, */*")
            .header("Referer", format!("https://kick.com/{slug}"))
            .header("Origin", "https://kick.com");
        if let Some(cookie) = cookie {
            request = request.header("Cookie", cookie);
        }
        match request.send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => {
                    return response
                        .json()
                        .await
                        .with_context(|| format!("parse {endpoint}"))
                }
                Err(err) => last_error = Some(anyhow!(err).context(format!("GET {endpoint}"))),
            },
            Err(err) => last_error = Some(anyhow!(err).context(format!("GET {endpoint}"))),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("Kick channel API request failed")))
}

fn find_chatroom_id(value: &Value) -> Option<String> {
    for pointer in [
        "/chatroom/id",
        "/chatroom_id",
        "/chatroomId",
        "/livestream/chatroom/id",
        "/live_stream/chatroom/id",
    ] {
        if let Some(id) = value.pointer(pointer).and_then(value_to_id) {
            return Some(id);
        }
    }
    find_chatroom_id_recursive(value)
}

fn find_chatroom_id_recursive(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(chatroom) = map.get("chatroom") {
                if let Some(id) = chatroom.get("id").and_then(value_to_id) {
                    return Some(id);
                }
            }
            for child in map.values() {
                if let Some(id) = find_chatroom_id_recursive(child) {
                    return Some(id);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(find_chatroom_id_recursive),
        _ => None,
    }
}

fn value_to_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .filter(|id| !id.is_empty())
}

async fn record_kick_chat(
    queue: Arc<QueueManager>,
    job_id: String,
    chatroom_id: String,
    output_path: PathBuf,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    started_at: Instant,
    subscription_tx: oneshot::Sender<Result<()>>,
) -> Result<KickLiveChatStats> {
    let pusher_url = format!(
        "wss://ws-us2.pusher.com/app/{PUSHER_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false"
    );
    let (mut ws, _) = connect_async(&pusher_url)
        .await
        .context("connect Kick Pusher websocket")?;
    let subscribe = json!({
        "event": "pusher:subscribe",
        "data": {
            "auth": "",
            "channel": format!("chatrooms.{chatroom_id}.v2")
        }
    });
    ws.send(Message::Text(subscribe.to_string()))
        .await
        .context("subscribe Kick chatroom")?;

    let mut messages = Vec::new();
    let mut seen = HashSet::new();
    let mut last_flush = Instant::now();
    let mut subscribed = false;
    let mut raw_events = 0_usize;
    let mut subscription_tx = Some(subscription_tx);
    let mut unparsed_chat_debug_left = 3_u8;
    loop {
        if stop.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
            break;
        }
        match tokio::time::timeout(Duration::from_secs(1), ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                    let event = raw.get("event").and_then(Value::as_str).unwrap_or("");
                    if event == "pusher_internal:subscription_succeeded" {
                        subscribed = true;
                        emit_log(
                            &queue,
                            &job_id,
                            &format!(
                                "Kick live chat recorder: subscribed to chatrooms.{chatroom_id}.v2"
                            ),
                        );
                        if let Some(tx) = subscription_tx.take() {
                            let _ = tx.send(Ok(()));
                        }
                    } else if event == "pusher:error" {
                        let err = anyhow!("Kick Pusher error: {text}");
                        if let Some(tx) = subscription_tx.take() {
                            let _ = tx.send(Err(anyhow!("Kick Pusher error: {text}")));
                        }
                        return Err(err);
                    }
                    if let Some((id, message)) =
                        parse_pusher_chat_message(&raw, started_at.elapsed().as_secs_f64())
                    {
                        raw_events += 1;
                        if seen.insert(id) {
                            messages.push(message);
                        }
                    } else if unparsed_chat_debug_left > 0
                        && (event.contains("Chat") || event.contains("Message"))
                    {
                        unparsed_chat_debug_left -= 1;
                        emit_log(
                            &queue,
                            &job_id,
                            &format!(
                                "!! Kick live chat recorder: unparsed event {event}: {}",
                                text.chars().take(700).collect::<String>()
                            ),
                        );
                    }
                }
            }
            Ok(Some(Ok(Message::Ping(payload)))) => {
                let _ = ws.send(Message::Pong(payload)).await;
            }
            Ok(Some(Ok(Message::Close(_)))) => {
                if let Some(tx) = subscription_tx.take() {
                    let _ = tx.send(Err(anyhow!(
                        "Kick Pusher websocket closed before subscription"
                    )));
                }
                break;
            }
            Ok(Some(Ok(_))) | Err(_) => {}
            Ok(Some(Err(err))) => {
                if let Some(tx) = subscription_tx.take() {
                    let _ = tx.send(Err(anyhow!("read Kick Pusher websocket: {err}")));
                }
                return Err(anyhow!(err).context("read Kick Pusher websocket"));
            }
            Ok(None) => {
                if let Some(tx) = subscription_tx.take() {
                    let _ = tx.send(Err(anyhow!(
                        "Kick Pusher websocket ended before subscription"
                    )));
                }
                break;
            }
        }
        if last_flush.elapsed() >= Duration::from_secs(5) {
            messages.sort_by(|a: &ChatMessage, b| a.timestamp.total_cmp(&b.timestamp));
            if !messages.is_empty() {
                write_chat_messages(&output_path, &messages)?;
            }
            emit_log(
                &queue,
                &job_id,
                &format!(
                    "Kick live chat recorder: parsed {} messages from {raw_events} raw chat events",
                    messages.len()
                ),
            );
            last_flush = Instant::now();
        }
    }
    messages.sort_by(|a: &ChatMessage, b| a.timestamp.total_cmp(&b.timestamp));
    if !messages.is_empty() {
        write_chat_messages(&output_path, &messages)?;
    }
    Ok(KickLiveChatStats {
        subscribed,
        raw_events,
        parsed_messages: messages.len(),
        output_path,
    })
}

pub(crate) fn parse_pusher_chat_message(
    raw: &Value,
    elapsed: f64,
) -> Option<(String, ChatMessage)> {
    let event = raw.get("event").and_then(Value::as_str).unwrap_or("");
    if !event.contains("ChatMessage") && !event.contains("MessageSent") {
        return None;
    }
    let data = parse_pusher_data(raw.get("data")?)?;
    let id = data.get("id").and_then(value_to_id).unwrap_or_else(|| {
        format!(
            "{elapsed:.3}:{}",
            data.get("content").unwrap_or(&Value::Null)
        )
    });
    let content = extract_message_content(&data)?;
    let created_at = data
        .get("created_at")
        .or_else(|| data.get("createdAt"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let sender = data.get("sender").or_else(|| data.get("user"));
    let username = sender
        .and_then(|sender| sender.get("slug").or_else(|| sender.get("username")))
        .and_then(Value::as_str)
        .unwrap_or("kick")
        .to_string();
    let display_name = sender
        .and_then(|sender| sender.get("username").or_else(|| sender.get("name")))
        .and_then(Value::as_str)
        .unwrap_or(&username)
        .to_string();
    let user_color = sender
        .and_then(|sender| {
            sender
                .pointer("/identity/color")
                .or_else(|| sender.get("color"))
        })
        .and_then(Value::as_str)
        .map(str::to_string);
    let badges = sender
        .and_then(|sender| {
            sender
                .pointer("/identity/badges")
                .or_else(|| sender.get("badges"))
        })
        .map(parse_kick_badges)
        .unwrap_or_default();

    Some((
        id,
        ChatMessage {
            timestamp: elapsed,
            created_at,
            username,
            display_name,
            user_color,
            badges,
            fragments: parse_kick_fragments(&content),
            source_platform: "kick".to_string(),
        },
    ))
}

fn parse_pusher_data(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => serde_json::from_str(text).ok(),
        other => Some(other.clone()),
    }
}

fn extract_message_content(data: &Value) -> Option<String> {
    let message_type = data
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("message");
    let mut content = data
        .get("content")
        .or_else(|| data.get("message"))
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
    }
    if content.trim().is_empty() {
        None
    } else {
        Some(content)
    }
}

fn parse_kick_badges(value: &Value) -> Vec<ChatBadge> {
    let badges = match value {
        Value::Array(items) => items.clone(),
        Value::String(text) => serde_json::from_str::<Vec<Value>>(text).unwrap_or_default(),
        _ => Vec::new(),
    };
    badges
        .iter()
        .filter_map(|item| {
            let id = item
                .get("type")
                .or_else(|| item.get("id"))
                .or_else(|| item.get("slug"))
                .and_then(Value::as_str)?
                .to_string();
            Some(ChatBadge {
                provider: "kick".to_string(),
                id,
                version: item
                    .get("count")
                    .or_else(|| item.get("version"))
                    .and_then(value_to_id),
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

#[cfg(test)]
mod tests {
    use super::{is_kick_live_channel_url, parse_pusher_chat_message};
    use crate::chat_overlay::model::ChatFragment;
    use serde_json::json;

    #[test]
    fn kick_live_channel_url_excludes_vod_and_kickvod_urls() {
        assert!(is_kick_live_channel_url("https://kick.com/5opka-bo55ik"));
        assert!(is_kick_live_channel_url(
            "https://www.kick.com/some-channel"
        ));
        assert!(!is_kick_live_channel_url(
            "https://kick.com/5opka-bo55ik/videos/15c998d7-a8b0-4bd1-b898-97c178d9baf2"
        ));
        assert!(!is_kick_live_channel_url(
            "https://kickvod.com/5opka-bo55ik/15c998d7-a8b0-4bd1-b898-97c178d9baf2"
        ));
    }

    #[test]
    fn parses_kick_pusher_chat_message_event() {
        let event = json!({
            "event": "App\\Events\\ChatMessageEvent",
            "data": "{\"id\":\"520e4568-e0e4-42ca-841a-80d84a8f92e9\",\"chatroom_id\":36120288,\"content\":\"hello [emote:123:wave]\",\"type\":\"message\",\"created_at\":\"2026-05-05T19:30:21+00:00\",\"sender\":{\"id\":28963646,\"username\":\"Esemine8\",\"slug\":\"esemine8\",\"identity\":{\"color\":\"#FBCFD8\",\"badges\":[]}},\"metadata\":{\"message_ref\":\"1778009420899\"}}",
            "channel": "chatrooms.36120288.v2"
        });
        let (id, message) = parse_pusher_chat_message(&event, 12.5).expect("parse message");
        assert_eq!(id, "520e4568-e0e4-42ca-841a-80d84a8f92e9");
        assert_eq!(message.timestamp, 12.5);
        assert_eq!(message.username, "esemine8");
        assert_eq!(message.display_name, "Esemine8");
        assert_eq!(message.user_color.as_deref(), Some("#FBCFD8"));
        assert_eq!(message.source_platform, "kick");
        assert!(message.fragments.iter().any(|fragment| matches!(
            fragment,
            ChatFragment::Emote { provider, id, .. } if provider == "kick" && id == "123"
        )));
    }
}
