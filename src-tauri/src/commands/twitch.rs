use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use futures::StreamExt;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

use crate::app_log::LogLevel;
use crate::AppState;

/// Twitch CDN domains that typically host VOD storage (from community research).
const DOMAINS: &[&str] = &[
    "https://ds0h3roq6wcgc.cloudfront.net/",
    "https://d2nvs31859zcd8.cloudfront.net/",
    "https://d2aba1wr3818hz.cloudfront.net/",
    "https://d3c27h4odz752x.cloudfront.net/",
    "https://dgeft87wbj63p.cloudfront.net/",
    "https://d1m7jfoe9zdc1j.cloudfront.net/",
    "https://d3vd9lfkzbru3h.cloudfront.net/",
    "https://ddacn6pr5v0tl.cloudfront.net/",
    "https://d3aqoihi2n8ty8.cloudfront.net/",
    "https://d3fi1amfgojobc.cloudfront.net/",
    "https://d1g1f25tn8m2e6.cloudfront.net/",
    "https://d1oca24q5dwo6d.cloudfront.net/",
    "https://d1w2poirtb3as9.cloudfront.net/",
    "https://d2dylwb3shzel1.cloudfront.net/",
    "https://d2um2qdswy1tb0.cloudfront.net/",
    "https://d2xmjdvx03ij56.cloudfront.net/",
    "https://d36nr0u3xmc4mm.cloudfront.net/",
    "https://d6d4ismr40iw.cloudfront.net/",
    "https://d6tizftlrpuof.cloudfront.net/",
    "https://dykkng5hnh52u.cloudfront.net/",
    "https://d2vi6trrdongqn.cloudfront.net/",
    "https://d3stzm2eumvgb4.cloudfront.net/",
];

/// Regex for twitchtracker.com/{user}/streams/{id}
static RE_TRACKER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"twitchtracker\.com/([^/]+)/streams/(\d+)").unwrap());
/// Regex for streamscharts.com/channels/{user}/streams/{id}
static RE_CHARTS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"streamscharts\.com/channels/([^/]+)/streams/(\d+)").unwrap());
/// Regex for sullygnome.com/channel/{user}/stream/{id}
static RE_SULLY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"sullygnome\.com/channel/([^/]+)/stream/(\d+)").unwrap());
/// Direct twitch vod url: twitch.tv/videos/{id}
static RE_VOD: Lazy<Regex> = Lazy::new(|| Regex::new(r"twitch\.tv/videos/(\d+)").unwrap());
static RE_TWITCH_LOGIN: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_]{3,25}$").unwrap());
const TWITCH_WEB_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";

#[derive(Debug, Serialize, Deserialize)]
pub struct TwitchHint {
    pub username: Option<String>,
    pub stream_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackerMeta {
    pub username: Option<String>,
    pub stream_id: Option<String>,
    pub start_time: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    /// Every plausible stream-start timestamp we could find on the page —
    /// the UI lets the user pick one if auto-detect guessed wrong.
    #[serde(default)]
    pub candidates: Vec<String>,
}

/// Best-effort extraction of (username, stream_id) from a pasted URL.
#[tauri::command]
pub fn twitch_parse_url(url: String) -> TwitchHint {
    let u = url.trim();
    if let Some(c) = RE_TRACKER.captures(u) {
        return TwitchHint {
            username: Some(c[1].to_lowercase()),
            stream_id: Some(c[2].to_string()),
            source: "twitchtracker".into(),
        };
    }
    if let Some(c) = RE_CHARTS.captures(u) {
        return TwitchHint {
            username: Some(c[1].to_lowercase()),
            stream_id: Some(c[2].to_string()),
            source: "streamscharts".into(),
        };
    }
    if let Some(c) = RE_SULLY.captures(u) {
        return TwitchHint {
            username: Some(c[1].to_lowercase()),
            stream_id: Some(c[2].to_string()),
            source: "sullygnome".into(),
        };
    }
    if let Some(c) = RE_VOD.captures(u) {
        return TwitchHint {
            username: None,
            stream_id: Some(c[1].to_string()),
            source: "twitch_vod".into(),
        };
    }
    TwitchHint {
        username: None,
        stream_id: None,
        source: "unknown".into(),
    }
}

#[derive(Debug, Deserialize)]
pub struct FinderRequest {
    pub username: String,
    pub stream_id: String,
    /// Free-form time string: accepts Unix secs, ISO 8601, "YYYY-MM-DD HH:MM[:SS]",
    /// "DD.MM.YYYY HH:MM", "HH:MM" (today), etc.
    pub start_time: String,
    /// "local" (default) or "utc" — timezone in which start_time is expressed.
    #[serde(default)]
    pub timezone: Option<String>,
    /// Seconds around the given timestamp to probe (default 90).
    #[serde(default)]
    pub window: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct FinderResult {
    pub urls: Vec<String>,
    pub tried: u32,
    pub timestamp_utc: i64,
}

#[derive(Debug, Deserialize)]
pub struct TwitchStreamsRequest {
    pub username: String,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwitchStreamListItem {
    pub date: Option<String>,
    pub start_time: Option<String>,
    pub title: Option<String>,
    pub duration_minutes: Option<u32>,
    pub game: Option<String>,
    pub url: Option<String>,
    pub stream_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TwitchStreamsPage {
    pub username: String,
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
    pub items: Vec<TwitchStreamListItem>,
}

#[derive(Debug, Deserialize)]
pub struct TwitchPublicVodsRequest {
    pub login: String,
    #[serde(default)]
    pub first: Option<u32>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchBroadcaster {
    pub id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchPublicVod {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub duration: String,
    pub duration_seconds: Option<u64>,
    pub url: String,
    pub thumbnail_url: Option<String>,
    pub viewable: String,
    pub public: bool,
    pub stream_id: Option<String>,
    pub chat_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchPublicVodPage {
    pub broadcaster: TwitchBroadcaster,
    pub items: Vec<TwitchPublicVod>,
    pub cursor: Option<String>,
    pub has_next_page: bool,
}

#[tauri::command]
pub async fn twitch_public_vods(
    state: State<'_, AppState>,
    req: TwitchPublicVodsRequest,
) -> Result<TwitchPublicVodPage, String> {
    let queue = state.queue.clone();
    let login = req.login.trim().trim_start_matches('@').to_lowercase();
    let first = req.first.unwrap_or(20).clamp(1, 100);
    let cursor = req.cursor.filter(|value| !value.trim().is_empty());
    let input = json!({
        "login": login.clone(),
        "first": first,
        "cursor": cursor,
    });

    if login.is_empty() {
        return Err("Введите ник Twitch-стримера.".to_string());
    }
    if !RE_TWITCH_LOGIN.is_match(&login) {
        return Err(
            "Ник Twitch должен содержать только латиницу, цифры и подчёркивание.".to_string(),
        );
    }

    queue.emit_app_log(
        LogLevel::Info,
        "twitch_public_vods_lookup_started",
        "Started public Twitch VOD lookup",
        Some(input.clone()),
    );

    let page = fetch_public_twitch_vods(&login, first, cursor.as_deref())
        .await
        .map_err(|err| {
            queue.emit_app_error(
                "twitch_public_vods_lookup_failed",
                err.clone(),
                None,
                Some(input.clone()),
            );
            err
        })?;

    queue.emit_app_log(
        LogLevel::Info,
        "twitch_public_vods_lookup_finished",
        format!(
            "Loaded public Twitch VODs for {}: {} items",
            page.broadcaster.login,
            page.items.len()
        ),
        Some(json!({
            "login": page.broadcaster.login,
            "broadcaster_id": page.broadcaster.id,
            "items": page.items.len(),
            "has_next_page": page.has_next_page,
        })),
    );

    Ok(page)
}

#[tauri::command]
pub async fn twitch_find_m3u8(
    state: State<'_, AppState>,
    req: FinderRequest,
) -> Result<FinderResult, String> {
    let queue = state.queue.clone();
    let input = json!({
        "username": req.username.clone(),
        "stream_id": req.stream_id.clone(),
        "start_time": req.start_time.clone(),
        "timezone": req.timezone.clone(),
        "window": req.window,
    });
    queue.emit_app_log(
        LogLevel::Info,
        "twitch_find_m3u8_started",
        "Started Twitch m3u8 candidate probing",
        Some(input.clone()),
    );

    let ts = match parse_time(&req.start_time, req.timezone.as_deref()) {
        Ok(ts) => ts,
        Err(e) => {
            let msg = format!("Bad time: {e}");
            queue.emit_app_error(
                "twitch_find_m3u8_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(input),
            );
            return Err(msg);
        }
    };
    let window: i64 = req.window.unwrap_or(90) as i64;

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| {
            let msg = e.to_string();
            queue.emit_app_error(
                "twitch_find_m3u8_failed",
                msg.clone(),
                Some(format!("{e:?}")),
                Some(input.clone()),
            );
            msg
        })?;

    let username = req.username.trim().to_lowercase();
    let stream_id = req.stream_id.trim().to_string();
    let client = Arc::new(client);

    // Generate candidates: every second in [ts-window, ts+window] × all domains.
    let mut candidates: Vec<String> = Vec::with_capacity(DOMAINS.len() * (window as usize * 2 + 1));
    for t in (ts - window)..=(ts + window) {
        for d in DOMAINS.iter() {
            candidates.push(construct_url(d, &username, &stream_id, t));
        }
    }
    let tried = candidates.len() as u32;

    // Concurrency-bounded probing.
    const MAX_INFLIGHT: usize = 128;
    let mut stream = futures::stream::iter(candidates.into_iter().map(|url| {
        let c = client.clone();
        async move { probe(&c, url).await }
    }))
    .buffer_unordered(MAX_INFLIGHT);

    let mut urls = Vec::new();
    while let Some(r) = stream.next().await {
        if let Ok(Some(u)) = r {
            urls.push(u);
        }
    }
    urls.sort();
    urls.dedup();
    queue.emit_app_log(
        LogLevel::Info,
        "twitch_find_m3u8_finished",
        format!(
            "Finished Twitch m3u8 probing: tried {tried}, found {}",
            urls.len()
        ),
        Some(json!({
            "username": username,
            "stream_id": stream_id,
            "tried": tried,
            "found": urls.len(),
            "timestamp_utc": ts,
        })),
    );
    Ok(FinderResult {
        urls,
        tried,
        timestamp_utc: ts,
    })
}

#[tauri::command]
pub async fn twitch_tracker_streams(
    app: AppHandle,
    state: State<'_, AppState>,
    req: TwitchStreamsRequest,
) -> Result<TwitchStreamsPage, String> {
    let queue = state.queue.clone();
    let username = req.username.trim().trim_start_matches('@').to_lowercase();
    let page = req.page.unwrap_or(1).max(1);
    let page_size = req.page_size.unwrap_or(8).clamp(1, 20);
    let input = json!({
        "username": username.clone(),
        "page": page,
        "page_size": page_size,
    });

    if username.is_empty() {
        let msg = "Введите ник Twitch-стримера.".to_string();
        queue.emit_app_error(
            "twitch_streams_lookup_failed",
            msg.clone(),
            None,
            Some(input),
        );
        return Err(msg);
    }
    if !RE_TWITCH_LOGIN.is_match(&username) {
        let msg = "Ник Twitch должен содержать только латиницу, цифры и подчёркивание.".to_string();
        queue.emit_app_error(
            "twitch_streams_lookup_failed",
            msg.clone(),
            None,
            Some(input),
        );
        return Err(msg);
    }

    queue.emit_app_log(
        LogLevel::Info,
        "twitch_streams_lookup_started",
        "Started TwitchTracker stream list lookup",
        Some(input.clone()),
    );

    match fetch_twitchtracker_streams(&username, page, page_size).await {
        Ok(result) => {
            queue.emit_app_log(
                LogLevel::Info,
                "twitch_streams_lookup_finished",
                format!(
                    "Loaded TwitchTracker streams: total {}, page {}, items {}",
                    result.total,
                    result.page,
                    result.items.len()
                ),
                Some(json!({
                    "username": result.username.clone(),
                    "page": result.page,
                    "page_size": result.page_size,
                    "total": result.total,
                    "items": result.items.len(),
                })),
            );
            Ok(result)
        }
        Err(err) => {
            if should_fallback_twitchtracker_streams(&err) {
                queue.emit_app_log(
                    LogLevel::Info,
                    "twitch_streams_lookup_webview_fallback_started",
                    "TwitchTracker HTTP lookup was blocked; trying WebView fallback",
                    Some(json!({
                        "username": username.clone(),
                        "page": page,
                        "page_size": page_size,
                        "reason": err.message,
                        "traceback": err.traceback,
                    })),
                );
                match scrape_twitchtracker_streams_via_webview(&app, &username).await {
                    Ok(items) => {
                        match paginate_twitch_streams(username.clone(), page, page_size, items) {
                            Ok(result) => {
                                queue.emit_app_log(
                                LogLevel::Info,
                                "twitch_streams_lookup_webview_fallback_finished",
                                format!(
                                    "Loaded TwitchTracker streams through WebView: total {}, page {}, items {}",
                                    result.total,
                                    result.page,
                                    result.items.len()
                                ),
                                Some(json!({
                                    "username": result.username.clone(),
                                    "page": result.page,
                                    "page_size": result.page_size,
                                    "total": result.total,
                                    "items": result.items.len(),
                                })),
                            );
                                return Ok(result);
                            }
                            Err(page_err) => {
                                queue.emit_app_error(
                                    "twitch_streams_lookup_failed",
                                    page_err.to_string(),
                                    page_err.traceback,
                                    Some(input),
                                );
                                return Err(page_err.message);
                            }
                        }
                    }
                    Err(fallback_err) => {
                        queue.emit_app_error(
                            "twitch_streams_lookup_webview_fallback_failed",
                            fallback_err.to_string(),
                            fallback_err.traceback.clone(),
                            Some(json!({
                                "username": username,
                                "page": page,
                                "page_size": page_size,
                            })),
                        );
                        return Err(fallback_err.message);
                    }
                }
            }
            queue.emit_app_error(
                "twitch_streams_lookup_failed",
                err.to_string(),
                err.traceback,
                Some(input),
            );
            Err(err.message)
        }
    }
}

#[tauri::command]
pub fn twitch_finder_log_action(
    state: State<'_, AppState>,
    action: String,
    input: Option<Value>,
) -> Result<(), String> {
    let action = action.trim();
    if action.is_empty() {
        return Ok(());
    }
    state.queue.emit_app_log(
        LogLevel::Info,
        &format!("twitch_finder_{action}"),
        "Finder UI action",
        input,
    );
    Ok(())
}

fn construct_url(domain: &str, username: &str, stream_id: &str, ts: i64) -> String {
    let input = format!("{username}_{stream_id}_{ts}");
    let mut hasher = Sha1::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let hex_full = hex::encode(digest);
    let hash_prefix = &hex_full[..20];
    format!("{domain}{hash_prefix}_{input}/chunked/index-dvr.m3u8")
}

async fn probe(client: &reqwest::Client, url: String) -> anyhow::Result<Option<String>> {
    let resp = client.head(&url).send().await?;
    if resp.status().is_success() {
        Ok(Some(url))
    } else {
        Ok(None)
    }
}

#[derive(Debug)]
struct StreamsLookupError {
    message: String,
    traceback: Option<String>,
}

impl StreamsLookupError {
    fn new(message: impl Into<String>, traceback: Option<String>) -> Self {
        Self {
            message: message.into(),
            traceback,
        }
    }
}

impl std::fmt::Display for StreamsLookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn should_fallback_twitchtracker_streams(err: &StreamsLookupError) -> bool {
    let mut text = err.message.to_lowercase();
    if let Some(traceback) = err.traceback.as_deref() {
        text.push(' ');
        text.push_str(&traceback.to_lowercase());
    }
    text.contains("403")
        || text.contains("forbidden")
        || text.contains("cloudflare")
        || text.contains("challenge")
        || text.contains("html-")
        || text.contains("html-структура")
}

fn paginate_twitch_streams(
    username: String,
    page: u32,
    page_size: u32,
    mut items: Vec<TwitchStreamListItem>,
) -> Result<TwitchStreamsPage, StreamsLookupError> {
    if items.is_empty() {
        return Err(StreamsLookupError::new(
            "У стримера нет найденных стримов на TwitchTracker.",
            None,
        ));
    }
    for item in items.iter_mut() {
        if item.start_time.is_none() {
            if let Some(date) = item.date.as_deref() {
                item.start_time = tracker_date_to_iso_utc(date);
            }
        }
        if item.url.is_none() {
            if let Some(id) = item.stream_id.as_deref() {
                item.url = Some(format!("https://twitchtracker.com/{username}/streams/{id}"));
            }
        }
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    let total = items.len() as u32;
    let start = ((page - 1) * page_size) as usize;
    let end = (start + page_size as usize).min(items.len());
    let page_items = if start < items.len() {
        items[start..end].to_vec()
    } else {
        Vec::new()
    };

    Ok(TwitchStreamsPage {
        username,
        page,
        page_size,
        total,
        items: page_items,
    })
}

async fn fetch_public_twitch_vods(
    login: &str,
    first: u32,
    cursor: Option<&str>,
) -> Result<TwitchPublicVodPage, String> {
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Не удалось подготовить HTTP-клиент Twitch: {e}"))?;

    let query = r#"
      query FetchrPublicVods($login: String!, $first: Int!, $cursor: Cursor) {
        user(login: $login) {
          id
          login
          displayName
          profileImageURL(width: 150)
          videos(first: $first, after: $cursor, type: ARCHIVE, sort: TIME) {
            edges {
              cursor
              node {
                id
                title
                createdAt
                lengthSeconds
                previewThumbnailURL(width: 320, height: 180)
                broadcastType
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
    "#;

    let payload = json!({
        "operationName": "FetchrPublicVods",
        "query": query,
        "variables": {
            "login": login,
            "first": first,
            "cursor": cursor,
        }
    });

    let value: Value = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-ID", TWITCH_WEB_CLIENT_ID)
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

    if let Some(errors) = value.get("errors").and_then(|errors| errors.as_array()) {
        let message = errors
            .iter()
            .filter_map(|error| error.get("message").and_then(|message| message.as_str()))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(if message.is_empty() {
            "Twitch вернул ошибку при получении публичных VOD.".to_string()
        } else {
            message
        });
    }

    let user = value
        .get("data")
        .and_then(|data| data.get("user"))
        .filter(|user| !user.is_null())
        .ok_or_else(|| "Twitch-канал не найден или недоступен публично.".to_string())?;

    let broadcaster = TwitchBroadcaster {
        id: string_field(user, "id").ok_or_else(|| "Twitch user id missing".to_string())?,
        login: string_field(user, "login").unwrap_or_else(|| login.to_string()),
        display_name: string_field(user, "displayName").unwrap_or_else(|| login.to_string()),
        profile_image_url: string_field(user, "profileImageURL"),
    };

    let videos = user
        .get("videos")
        .ok_or_else(|| "Twitch не вернул список публичных VOD.".to_string())?;
    let edges = videos
        .get("edges")
        .and_then(|edges| edges.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::new();
    let mut next_cursor = None;
    for edge in edges {
        next_cursor = string_field(&edge, "cursor").or(next_cursor);
        let Some(node) = edge.get("node") else {
            continue;
        };
        let Some(id) = string_field(node, "id") else {
            continue;
        };
        let viewable = "public".to_string();
        let is_public = true;
        let duration_seconds = node.get("lengthSeconds").and_then(|value| value.as_u64());
        items.push(TwitchPublicVod {
            url: format!("https://www.twitch.tv/videos/{id}"),
            stream_id: None,
            chat_available: is_public,
            public: is_public,
            id,
            title: string_field(node, "title").unwrap_or_else(|| "Untitled Twitch VOD".to_string()),
            created_at: string_field(node, "createdAt").unwrap_or_default(),
            duration: duration_seconds
                .map(format_seconds)
                .unwrap_or_else(|| "—".to_string()),
            duration_seconds,
            thumbnail_url: string_field(node, "previewThumbnailURL"),
            viewable,
        });
    }

    let has_next_page = videos
        .get("pageInfo")
        .and_then(|page_info| page_info.get("hasNextPage"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    Ok(TwitchPublicVodPage {
        broadcaster,
        items,
        cursor: if has_next_page { next_cursor } else { None },
        has_next_page,
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
}

fn format_seconds(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m {secs}s")
    } else {
        format!("{secs}s")
    }
}

static RE_STREAMS_TABLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?is)<table[^>]+id=["']streams["'][^>]*>(.*?)</table>"#).unwrap());
static RE_TABLE_ROW: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<tr[^>]*>(.*?)</tr>"#).unwrap());
static RE_TABLE_CELL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?is)<td\b([^>]*)>(.*?)</td>"#).unwrap());
static RE_DATA_ORDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-order=["']([^"']+)["']"#).unwrap());
static RE_TAGS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<[^>]+>"#).unwrap());
static RE_ECS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<meta[^>]+id=["']ecs["'][^>]+content=["']([^"']+)["']"#).unwrap()
});
static RE_STREAM_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}"#).unwrap());
static RE_ROW_STREAM_HREF: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)/[A-Za-z0-9_]+/streams/(\d+)|twitchtracker\.com/[A-Za-z0-9_]+/streams/(\d+)"#)
        .unwrap()
});

async fn fetch_twitchtracker_streams(
    username: &str,
    page: u32,
    page_size: u32,
) -> Result<TwitchStreamsPage, StreamsLookupError> {
    let url = format!("https://twitchtracker.com/{username}/streams");
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| {
            StreamsLookupError::new(
                "Не удалось подготовить HTTP-клиент для TwitchTracker.",
                Some(format!("{e:?}")),
            )
        })?;

    let resp = client.get(&url).send().await.map_err(|e| {
        let msg = if e.is_timeout() || e.is_connect() {
            "Ошибка сети при обращении к TwitchTracker."
        } else {
            "TwitchTracker недоступен или не ответил корректно."
        };
        StreamsLookupError::new(msg, Some(format!("{e:?}")))
    })?;

    let status = resp.status();
    if status.as_u16() == 404 {
        return Err(StreamsLookupError::new(
            "Стример не найден на TwitchTracker.",
            Some(format!("HTTP {status} for {url}")),
        ));
    }
    if status.is_server_error() {
        return Err(StreamsLookupError::new(
            "TwitchTracker недоступен. Попробуйте позже.",
            Some(format!("HTTP {status} for {url}")),
        ));
    }
    if !status.is_success() {
        return Err(StreamsLookupError::new(
            format!("TwitchTracker вернул HTTP {status}."),
            Some(format!("HTTP {status} for {url}")),
        ));
    }

    let html = resp.text().await.map_err(|e| {
        StreamsLookupError::new(
            "Не удалось прочитать ответ TwitchTracker.",
            Some(format!("{e:?}")),
        )
    })?;

    if html.contains("Just a moment") || html.contains("challenge-platform") {
        return Err(StreamsLookupError::new(
            "TwitchTracker сейчас закрыт CloudFlare-проверкой или недоступен.",
            None,
        ));
    }
    if html.to_lowercase().contains("channel not found")
        || html.to_lowercase().contains("streamer not found")
    {
        return Err(StreamsLookupError::new(
            "Стример не найден на TwitchTracker.",
            None,
        ));
    }

    let items = parse_twitchtracker_streams_html(&html, username)?;
    if items.is_empty() {
        return Err(StreamsLookupError::new(
            "У стримера нет найденных стримов на TwitchTracker.",
            None,
        ));
    }

    paginate_twitch_streams(username.to_string(), page, page_size, items)
}

fn parse_twitchtracker_streams_html(
    html: &str,
    username: &str,
) -> Result<Vec<TwitchStreamListItem>, StreamsLookupError> {
    let table = RE_STREAMS_TABLE
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .ok_or_else(|| {
            StreamsLookupError::new(
                "HTML-структура TwitchTracker изменилась: таблица стримов не найдена.",
                None,
            )
        })?;
    let complicator = decode_twitchtracker_complicator(html);
    let mut rows_seen = 0usize;
    let mut items = Vec::new();

    for row in RE_TABLE_ROW.captures_iter(table) {
        let Some(row_html) = row.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let cells: Vec<(&str, &str)> = RE_TABLE_CELL
            .captures_iter(row_html)
            .filter_map(|c| Some((c.get(1)?.as_str(), c.get(2)?.as_str())))
            .collect();
        if cells.len() < 7 {
            continue;
        }
        rows_seen += 1;
        let date = extract_data_order(cells[0].0)
            .or_else(|| Some(clean_html_text(cells[0].1)))
            .map(|s| s.trim().to_string())
            .filter(|s| RE_STREAM_DATE.is_match(s));
        let Some(date) = date else {
            continue;
        };
        let duration_minutes = extract_data_order(cells[1].0)
            .and_then(|s| s.parse::<u32>().ok())
            .or_else(|| first_u32(&clean_html_text(cells[1].1)));
        let title = clean_html_text(cells[6].1);
        let title = if title.is_empty() { None } else { Some(title) };
        let details = complicator.as_ref().and_then(|v| v.get(&date));
        let stream_id = extract_stream_id(details).or_else(|| extract_href_stream_id(row_html));
        let game = extract_games(details).or_else(|| {
            cells
                .get(7)
                .map(|(_, body)| clean_html_text(body))
                .filter(|s| !s.is_empty())
        });
        let url = stream_id
            .as_ref()
            .map(|id| format!("https://twitchtracker.com/{username}/streams/{id}"));

        items.push(TwitchStreamListItem {
            date: Some(date.clone()),
            start_time: tracker_date_to_iso_utc(&date),
            title,
            duration_minutes,
            game,
            url,
            stream_id,
        });
    }

    if rows_seen == 0 {
        return Err(StreamsLookupError::new(
            "HTML-структура TwitchTracker изменилась: строки таблицы не распознаны.",
            None,
        ));
    }
    if !items.is_empty() && items.iter().all(|item| item.stream_id.is_none()) {
        return Err(StreamsLookupError::new(
            "HTML-структура TwitchTracker изменилась: id стримов не найдены.",
            None,
        ));
    }
    Ok(items)
}

fn decode_twitchtracker_complicator(html: &str) -> Option<Value> {
    let content = RE_ECS.captures(html)?.get(1)?.as_str();
    let marker = content.chars().next()?;
    let mut parts: Vec<&str> = content.split('!').collect();
    let keys_part = parts.pop()?;
    let keys: Vec<String> = decode_twitchtracker_payload(keys_part, marker)?;
    for (idx, key) in keys.iter().enumerate() {
        if key != "complicator" {
            continue;
        }
        let part = parts.get(idx)?;
        return decode_twitchtracker_payload(part, marker);
    }
    None
}

fn decode_twitchtracker_payload<T: serde::de::DeserializeOwned>(
    encoded: &str,
    marker: char,
) -> Option<T> {
    let mut normalized = encoded.replace(marker, "W");
    let rem = normalized.len() % 4;
    if rem != 0 {
        normalized.extend(std::iter::repeat('=').take(4 - rem));
    }
    let bytes = general_purpose::STANDARD.decode(normalized).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    serde_json::from_str(&text).ok()
}

fn extract_data_order(attrs: &str) -> Option<String> {
    RE_DATA_ORDER
        .captures(attrs)
        .and_then(|c| c.get(1))
        .map(|m| html_unescape(m.as_str()))
}

fn clean_html_text(html: &str) -> String {
    let no_tags = RE_TAGS.replace_all(html, " ");
    html_unescape(&no_tags)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_u32(s: &str) -> Option<u32> {
    s.split(|c: char| !c.is_ascii_digit())
        .find(|p| !p.is_empty())
        .and_then(|p| p.parse::<u32>().ok())
}

fn extract_stream_id(details: Option<&Value>) -> Option<String> {
    let id = details?.get("id")?;
    id.as_str()
        .map(|s| s.to_string())
        .or_else(|| id.as_u64().map(|n| n.to_string()))
}

fn extract_href_stream_id(row_html: &str) -> Option<String> {
    RE_ROW_STREAM_HREF.captures(row_html).and_then(|c| {
        c.get(1)
            .or_else(|| c.get(2))
            .map(|m| m.as_str().to_string())
    })
}

fn extract_games(details: Option<&Value>) -> Option<String> {
    let games = details?.get("games")?.as_array()?;
    let names: Vec<String> = games
        .iter()
        .filter_map(|g| g.get("name").and_then(|n| n.as_str()))
        .map(html_unescape)
        .filter(|s| !s.trim().is_empty())
        .collect();
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn tracker_date_to_iso_utc(date: &str) -> Option<String> {
    NaiveDateTime::parse_from_str(date, "%Y-%m-%d %H:%M")
        .ok()
        .map(|naive| {
            Utc.from_utc_datetime(&naive)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        })
}

/// Parse flexible time strings. Returns Unix timestamp (seconds).
fn parse_time(s: &str, tz: Option<&str>) -> anyhow::Result<i64> {
    let s = s.trim();
    if s.is_empty() {
        anyhow::bail!("empty");
    }

    // Unix seconds
    if let Ok(n) = s.parse::<i64>() {
        if n > 1_000_000_000 {
            return Ok(n);
        }
    }

    // ISO 8601 with tz
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(dt.timestamp());
    }

    // Try RFC-2822 too (some feeds emit "Thu, 16 Apr 2026 05:58:10 GMT")
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Ok(dt.timestamp());
    }

    // Trim trailing Z and retry as UTC naive before the generic loop.
    let s_noz = s.trim_end_matches('Z').trim_end_matches('z');

    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%d.%m.%Y %H:%M:%S",
        "%d.%m.%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%d %b %Y %H:%M:%S",
        "%d %b %Y %H:%M",
        "%d/%b/%Y %H:%M:%S",
        "%d/%b/%Y %H:%M",
        "%b %d, %Y %H:%M:%S",
        "%b %d, %Y %H:%M",
        "%b %d %Y %H:%M:%S",
        "%b %d %Y %H:%M",
        "%b %d, %Y %I:%M %p",
        "%b %d, %Y %I:%M:%S %p",
    ];
    for f in formats {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, f) {
            return Ok(naive_to_utc(naive, tz));
        }
        if let Ok(naive) = NaiveDateTime::parse_from_str(s_noz, f) {
            // Had a Z suffix — interpret as UTC regardless of tz hint.
            return Ok(Utc.from_utc_datetime(&naive).timestamp());
        }
    }

    // "HH:MM" — today in local time.
    if let Ok(naive_time) = chrono::NaiveTime::parse_from_str(s, "%H:%M") {
        let today = Local::now().date_naive();
        let naive = NaiveDateTime::new(today, naive_time);
        return Ok(naive_to_utc(naive, tz));
    }

    anyhow::bail!("unrecognized time format: {s}");
}

fn naive_to_utc(naive: NaiveDateTime, tz: Option<&str>) -> i64 {
    let tz_s = tz.unwrap_or("local");
    if tz_s.eq_ignore_ascii_case("utc") {
        Utc.from_utc_datetime(&naive).timestamp()
    } else {
        // local
        let local = Local
            .from_local_datetime(&naive)
            .single()
            .unwrap_or_else(|| {
                // Fallback: treat as UTC on DST ambiguity
                let utc = Utc.from_utc_datetime(&naive);
                utc.with_timezone(&Local)
            });
        local.timestamp()
    }
}

// ---------------------------------------------------------------------------
// Best-effort scraper that pulls stream start-time out of twitchtracker /
// streamscharts / sullygnome pages so the UI only needs a URL.
// ---------------------------------------------------------------------------

/// Regex grabs the first `YYYY-MM-DD HH:MM(:SS)?` or `YYYY-MM-DDTHH:MM(:SS)?`.
static RE_ISO_LIKE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)").unwrap());
/// Meta tag extractor: `<meta property="og:title" content="...">`
static RE_OG_TITLE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']"#).unwrap()
});
static RE_OG_IMAGE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']"#).unwrap()
});

/// JSON payload posted by the scraper WebView's injected script via a
/// navigation to our capture URL.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ScrapePayload {
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub stream_id: Option<String>,
    #[serde(default)]
    pub candidates: Vec<String>,
}

fn is_cf_protected(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("twitchtracker.com")
        || u.contains("streamscharts.com")
        || u.contains("sullygnome.com")
}

#[tauri::command]
pub async fn twitch_tracker_fetch(app: AppHandle, url: String) -> Result<TrackerMeta, String> {
    let hint = twitch_parse_url(url.clone());

    // CF-gated sites require a real browser to pass the JS challenge.
    if is_cf_protected(&url) {
        return scrape_via_webview(&app, &url, &hint).await;
    }

    // Plain HTTP path (Twitch direct / other sites without CF).
    scrape_via_reqwest(&url, &hint).await
}

async fn scrape_via_reqwest(url: &str, hint: &TwitchHint) -> Result<TrackerMeta, String> {
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read body: {e}"))?;

    if html.contains("Just a moment") || html.contains("challenge-platform") {
        return Err("CloudFlare challenge detected — use webview scraper".into());
    }

    let start_time = RE_ISO_LIKE
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let title = RE_OG_TITLE
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| html_unescape(m.as_str()));
    let thumbnail = RE_OG_IMAGE
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    Ok(TrackerMeta {
        username: hint.username.clone(),
        stream_id: hint.stream_id.clone(),
        start_time,
        title,
        thumbnail,
        candidates: vec![],
    })
}

#[derive(Debug, Deserialize)]
struct StreamsScrapePayload {
    #[serde(default)]
    items: Vec<TwitchStreamListItem>,
    error: Option<String>,
    traceback: Option<String>,
    #[serde(default)]
    blocked: bool,
    #[serde(default)]
    not_found: bool,
    #[serde(default)]
    html_changed: bool,
}

async fn scrape_twitchtracker_streams_via_webview(
    app: &AppHandle,
    username: &str,
) -> Result<Vec<TwitchStreamListItem>, StreamsLookupError> {
    let label = format!("streams-scraper-{}", uuid::Uuid::new_v4().simple());
    let url = format!("https://twitchtracker.com/{username}/streams");
    let parsed: url::Url = url.parse().map_err(|e: url::ParseError| {
        StreamsLookupError::new(
            "Не удалось подготовить URL TwitchTracker.",
            Some(format!("{e:?}")),
        )
    })?;
    let script = build_streams_scraper_script(username);

    let payload: Arc<StdMutex<Option<StreamsScrapePayload>>> = Arc::new(StdMutex::new(None));
    let done: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    let payload_clone = payload.clone();
    let done_clone = done.clone();

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title("Получаем список стримов TwitchTracker...")
        .inner_size(1080.0, 760.0)
        .center()
        .resizable(true)
        .initialization_script(&script)
        .on_navigation(move |nav_url| {
            if nav_url.host_str() == Some("scrape-capture.invalid") {
                for (key, value) in nav_url.query_pairs() {
                    if key == "data" {
                        match serde_json::from_str::<StreamsScrapePayload>(&value) {
                            Ok(parsed) => {
                                if let Ok(mut slot) = payload_clone.lock() {
                                    *slot = Some(parsed);
                                }
                                done_clone.store(true, Ordering::SeqCst);
                            }
                            Err(e) => tracing::warn!("streams scraper: bad payload json: {e}"),
                        }
                    }
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| {
            StreamsLookupError::new(
                "Не удалось открыть WebView для TwitchTracker fallback.",
                Some(format!("{e:?}")),
            )
        })?;

    let deadline = Instant::now() + Duration::from_secs(75);
    while Instant::now() < deadline {
        if done.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let _ = window.close();
    let result = payload.lock().ok().and_then(|mut slot| slot.take());
    let Some(result) = result else {
        return Err(StreamsLookupError::new(
            "TwitchTracker заблокирован CloudFlare или не отдал список стримов за 75 секунд.",
            Some(format!("WebView fallback timeout for {url}")),
        ));
    };

    if result.not_found {
        return Err(StreamsLookupError::new(
            "Стример не найден на TwitchTracker.",
            result.traceback,
        ));
    }
    if result.blocked {
        return Err(StreamsLookupError::new(
            "TwitchTracker заблокировал загрузку списка стримов CloudFlare-проверкой.",
            result.traceback,
        ));
    }
    if result.html_changed {
        return Err(StreamsLookupError::new(
            "HTML-структура TwitchTracker изменилась: таблица стримов не распознана.",
            result.traceback,
        ));
    }
    if let Some(error) = result.error {
        return Err(StreamsLookupError::new(error, result.traceback));
    }
    if result.items.is_empty() {
        return Err(StreamsLookupError::new(
            "У стримера нет найденных стримов на TwitchTracker.",
            None,
        ));
    }

    Ok(result.items)
}

fn build_streams_scraper_script(username: &str) -> String {
    let username_json = serde_json::to_string(username).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(function() {{
  if (window.__streams_scraper_running) return;
  window.__streams_scraper_running = true;
  const USERNAME = {username_json};

  const publish = (data) => {{
    try {{
      window.__streams_scraper_done = true;
      window.location.replace('https://scrape-capture.invalid/?data=' + encodeURIComponent(JSON.stringify(data)));
    }} catch (err) {{
      window.location.replace('https://scrape-capture.invalid/?data=' + encodeURIComponent(JSON.stringify({{
        error: 'Не удалось передать результат скрейпера.',
        traceback: String(err && (err.stack || err.message || err))
      }})));
    }}
  }};

  const text = (node) => (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  const firstNumber = (raw) => {{
    const m = String(raw || '').match(/\d+/);
    return m ? Number(m[0]) : null;
  }};
  const streamIdFromUrl = (url) => {{
    const m = String(url || '').match(/\/streams\/(\d+)/);
    return m ? m[1] : null;
  }};
  const gameFromDetails = (details) => {{
    if (!details || !Array.isArray(details.games)) return null;
    const names = details.games.map((g) => g && g.name).filter(Boolean);
    return names.length ? names.join(', ') : null;
  }};

  const extract = () => {{
    const pageText = text(document.body).toLowerCase();
    if (pageText.includes('channel not found') || pageText.includes('streamer not found')) {{
      return {{ not_found: true, traceback: 'TwitchTracker rendered not-found page.' }};
    }}

    const table = document.querySelector('#streams');
    if (!table) {{
      const title = (document.title || '').toLowerCase();
      const blocked = title.includes('just a moment') ||
        title.includes('checking your browser') ||
        !!document.querySelector('#challenge-form, #cf-wrapper, #challenge-running');
      if (blocked) {{
        return {{ blocked: true, traceback: 'CloudFlare challenge is still active.' }};
      }}
      return null;
    }}

    const rows = Array.from(table.querySelectorAll('tbody tr'))
      .filter((row) => row.querySelectorAll('td').length >= 2);
    if (!rows.length) {{
      return {{ html_changed: true, traceback: 'Rendered #streams table has no parseable body rows.' }};
    }}

    const items = [];
    for (const row of rows) {{
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 7) continue;
      const date = (cells[0].getAttribute('data-order') || text(cells[0])).trim();
      if (!/^\d{{4}}-\d{{2}}-\d{{2}}\s+\d{{2}}:\d{{2}}/.test(date)) continue;
      const details = window.Y && window.Y.complicator ? window.Y.complicator[date] : null;
      const linkEl = row.querySelector('a[href*="/streams/"]');
      const href = linkEl ? linkEl.href : null;
      const id = (details && details.id ? String(details.id) : null) || streamIdFromUrl(href);
      const durationRaw = cells[1].getAttribute('data-order') || text(cells[1]);
      const title = text(cells[6]) || null;
      let game = gameFromDetails(details);
      if (!game && cells[7]) {{
        const images = Array.from(cells[7].querySelectorAll('img[title], img[alt]'));
        const names = images.map((img) => img.getAttribute('title') || img.getAttribute('alt')).filter(Boolean);
        game = names.length ? names.join(', ') : (text(cells[7]) || null);
      }}
      items.push({{
        date,
        start_time: null,
        title,
        duration_minutes: firstNumber(durationRaw),
        game,
        url: id ? `https://twitchtracker.com/${{USERNAME}}/streams/${{id}}` : href,
        stream_id: id
      }});
    }}

    if (!items.length) {{
      return {{ html_changed: true, traceback: 'Rows were present, but stream fields could not be extracted.' }};
    }}
    return {{ items }};
  }};

  let attempts = 0;
  const MAX = 120;
  const tick = () => {{
    if (window.__streams_scraper_done) return;
    const result = extract();
    if (result) {{
      if (result.items || result.not_found || result.blocked || result.html_changed || result.error) {{
        publish(result);
        return;
      }}
    }}
    attempts++;
    if (attempts < MAX) setTimeout(tick, 600);
    else publish({{ blocked: true, traceback: 'Timed out waiting for rendered TwitchTracker stream table.' }});
  }};

  const kick = () => setTimeout(tick, 800);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick);
  else kick();
}})();"#
    )
}

/// Scrape a CloudFlare-protected tracker page by opening it in a real
/// WebView window. The injected init-script, once it has found the start
/// time in the rendered DOM, navigates the window to a synthetic host
/// `https://scrape-capture.invalid/?data=<urlencoded-json>`. The
/// `on_navigation` hook intercepts that, pulls the payload out of the
/// query string, cancels the navigation, and signals completion.
async fn scrape_via_webview(
    app: &AppHandle,
    url: &str,
    hint: &TwitchHint,
) -> Result<TrackerMeta, String> {
    let label = format!("scraper-{}", uuid::Uuid::new_v4().simple());
    let script = build_scraper_script();
    let parsed: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let payload: Arc<StdMutex<Option<ScrapePayload>>> = Arc::new(StdMutex::new(None));
    let done: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    let payload_clone = payload.clone();
    let done_clone = done.clone();

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title("Получаем данные стрима (CloudFlare)…")
        .inner_size(960.0, 720.0)
        .center()
        .resizable(true)
        .initialization_script(&script)
        .on_navigation(move |nav_url| {
            tracing::debug!("scraper: nav → {}", nav_url);
            if nav_url.host_str() == Some("scrape-capture.invalid") {
                for (k, v) in nav_url.query_pairs() {
                    if k == "data" {
                        match serde_json::from_str::<ScrapePayload>(&v) {
                            Ok(p) => {
                                tracing::info!("scraper: payload received ({} bytes)", v.len());
                                if let Ok(mut slot) = payload_clone.lock() {
                                    *slot = Some(p);
                                }
                                done_clone.store(true, Ordering::SeqCst);
                            }
                            Err(e) => tracing::warn!("scraper: bad payload json: {e}"),
                        }
                    }
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("failed to open scraper window: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if done.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let _ = window.close();

    let result = payload.lock().ok().and_then(|mut p| p.take());

    match result {
        Some(p) => Ok(TrackerMeta {
            username: hint.username.clone().or(p.username),
            stream_id: hint.stream_id.clone().or(p.stream_id),
            start_time: p.start_time,
            title: p.title,
            thumbnail: p.thumbnail,
            candidates: p.candidates,
        }),
        None => Err("Таймаут: страница не отдала данные за 60 секунд. \
             Возможно CloudFlare требует ручное прохождение или страница не содержит дату в DOM. \
             Попробуй ещё раз или введи время вручную."
            .into()),
    }
}

/// Script injected into the scraper WebView before any page script runs.
/// Waits for CF challenge to clear, extracts metadata from the rendered
/// DOM, then stashes the JSON-encoded result in `location.hash` where
/// the Rust side polls `webview.url()` picks it up.
fn build_scraper_script() -> String {
    r#"(function() {
  if (window.__scraper_running) return;
  window.__scraper_running = true;

  const PATTERNS = [
    /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/g,
    /(\d{2}\/[A-Za-z]{3}\/\d{4}[ :T]\d{2}:\d{2}(?::\d{2})?)/g,
    /(\d{2}\.\d{2}\.\d{4}[ ]\d{2}:\d{2}(?::\d{2})?)/g,
    /([A-Za-z]{3,9} \d{1,2},? \d{4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/g
  ];

  // Score a candidate by how "stream-start-ish" its surrounding context is.
  const KEYWORDS_GOOD = [
    'stream start', 'started at', 'start time', 'started on',
    'broadcast', 'went live', 'live since', 'begin', 'began',
    'duration', 'ended', 'stream ended', 'startdate'
  ];
  const KEYWORDS_BAD = [
    'last seen', 'last online', 'account created', 'joined', 'copyright',
    'footer', 'updated', 'now', 'today', 'current time'
  ];

  const scoreContext = (text) => {
    if (!text) return 0;
    const t = text.toLowerCase();
    let s = 0;
    for (const k of KEYWORDS_GOOD) if (t.includes(k)) s += 10;
    for (const k of KEYWORDS_BAD) if (t.includes(k)) s -= 8;
    return s;
  };

  // Turn any recognised date-string into a normalised ISO UTC form
  // (YYYY-MM-DDTHH:MM:00Z) so the caller doesn't have to guess TZ.
  // Returns null if we can't make sense of it.
  const normalise = (raw) => {
    if (!raw) return null;
    let s = String(raw).trim();
    if (s.length < 8 || s.length > 60) return null;

    // unix seconds / ms
    if (/^\d{10}$/.test(s)) {
      const d = new Date(parseInt(s, 10) * 1000);
      return isNaN(d) ? null : d.toISOString().slice(0, 16) + ':00Z';
    }
    if (/^\d{13}$/.test(s)) {
      const d = new Date(parseInt(s, 10));
      return isNaN(d) ? null : d.toISOString().slice(0, 16) + ':00Z';
    }

    // Already tagged with a timezone (Z or ±HH:MM) — trust it.
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const d = new Date(s);
      return isNaN(d) ? null : d.toISOString().slice(0, 16) + ':00Z';
    }

    // Bare ISO-like "YYYY-MM-DD[ T]HH:MM(:SS)?" — no TZ. Trackers like
    // TwitchTracker emit UTC values here without the trailing Z, so treat
    // as UTC.
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?$/);
    if (iso) {
      const d = new Date(iso[1] + 'T' + iso[2] + ':00Z');
      return isNaN(d) ? null : d.toISOString().slice(0, 16) + ':00Z';
    }

    // Anything else — let the browser try; its TZ assumption may be
    // wrong but usually the intended moment is preserved for human-
    // readable strings that already match the user's locale.
    const d = new Date(s);
    if (!isNaN(d) && d.getFullYear() > 2010 && d.getFullYear() < 2100) {
      return d.toISOString().slice(0, 16) + ':00Z';
    }
    return null;
  };

  const collectCandidates = () => {
    const candidates = [];
    const seen = new Set();

    const push = (raw, score) => {
      const v = normalise(raw);
      if (!v) return;
      if (seen.has(v)) {
        for (const c of candidates) if (c.v === v) c.s += score;
        return;
      }
      seen.add(v);
      candidates.push({ v, s: score });
    };

    // 1) datetime / data-* / title / data-utc attributes
    const attrEls = document.querySelectorAll(
      '[datetime], [data-utc], [data-timestamp], [data-time], [title]'
    );
    attrEls.forEach((el) => {
      const vals = [
        el.getAttribute('datetime'),
        el.getAttribute('data-utc'),
        el.getAttribute('data-timestamp'),
        el.getAttribute('data-time'),
        el.getAttribute('title')
      ];
      const ctx = (el.textContent || '') + ' ' +
        (el.parentElement ? el.parentElement.textContent || '' : '');
      const baseScore = 5 + scoreContext(ctx);
      for (const v of vals) push(v, baseScore);
    });

    // 2) JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const data = JSON.parse(s.textContent || '{}');
        const vals = [data.startDate, data.uploadDate, data.datePublished]
          .filter(Boolean);
        for (const v of vals) push(String(v), 20);
      } catch (_) {}
    });

    // 3) regex scan inside text-content of elements
    const textEls = document.querySelectorAll('div,span,td,th,p,li,h1,h2,h3,h4,strong,b,small,time,abbr');
    textEls.forEach((el) => {
      const text = el.textContent || '';
      if (!text || text.length > 200) return;
      const ctx = text + ' ' +
        (el.parentElement ? el.parentElement.textContent || '' : '');
      const baseScore = scoreContext(ctx);
      for (const p of PATTERNS) {
        const matches = text.match(p);
        if (matches) matches.forEach((m) => push(m, 2 + baseScore));
      }
    });

    // 4) final regex scan over full HTML (lowest priority)
    const html = (document.documentElement ? document.documentElement.outerHTML : '') || '';
    for (const p of PATTERNS) {
      const matches = html.match(p);
      if (matches) matches.slice(0, 20).forEach((m) => push(m, 0));
    }

    candidates.sort((a, b) => b.s - a.s);
    return candidates.slice(0, 12).map((c) => c.v);
  };

  const extract = () => {
    const out = {};
    const og = document.querySelector('meta[property="og:title"]');
    if (og) out.title = og.getAttribute('content') || null;
    const ogi = document.querySelector('meta[property="og:image"]');
    if (ogi) out.thumbnail = ogi.getAttribute('content') || null;

    const candidates = collectCandidates();
    out.candidates = candidates;
    if (candidates.length > 0) out.start_time = candidates[0];
    return out;
  };

  const publish = (data) => {
    try {
      const json = encodeURIComponent(JSON.stringify(data));
      window.__scraper_done = true;
      window.location.replace('https://scrape-capture.invalid/?data=' + json);
      return true;
    } catch (_) { return false; }
  };

  let attempts = 0;
  const MAX = 80;
  const tick = () => {
    if (window.__scraper_done) return;
    const title = (document.title || '').toLowerCase();
    const onChallenge =
      title.includes('just a moment') ||
      title.includes('checking your browser') ||
      document.querySelector('#challenge-form, #cf-wrapper, #challenge-running');
    if (onChallenge) {
      attempts++;
      if (attempts < MAX) setTimeout(tick, 800);
      else publish({});
      return;
    }
    const data = extract();
    if (data.start_time) {
      publish(data);
      return;
    }
    attempts++;
    if (attempts < MAX) setTimeout(tick, 600);
    else publish(data);
  };

  const kick = () => setTimeout(tick, 600);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kick);
  } else {
    kick();
  }
})();"#.to_string()
}

/// Minimal HTML entity decoder for the few entities og:title usually has.
fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}
