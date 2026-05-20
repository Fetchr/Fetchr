use std::collections::HashMap;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use image::codecs::gif::GifDecoder;
use image::codecs::webp::WebPDecoder;
use image::{imageops, AnimationDecoder, DynamicImage, RgbaImage};
use sha1::{Digest, Sha1};

use crate::chat_overlay::emit_log;
use crate::jobs::queue::QueueManager;
use crate::jobs::types::JobProgress;

#[derive(Debug, Clone)]
pub struct AnimatedImage {
    frames: Vec<DynamicImage>,
    cumulative_ms: Vec<u32>,
    duration_ms: u32,
}

#[derive(Debug, Clone)]
pub struct ScaledAnimatedImage {
    frames: Vec<RgbaImage>,
    cumulative_ms: Vec<u32>,
    duration_ms: u32,
}

impl AnimatedImage {
    pub fn from_static(image: DynamicImage) -> Self {
        Self {
            frames: vec![image],
            cumulative_ms: vec![1000],
            duration_ms: 1000,
        }
    }

    #[allow(dead_code)]
    pub fn frame_at(&self, seconds: f64) -> &DynamicImage {
        &self.frames[self.frame_index_at(seconds)]
    }

    #[allow(dead_code)]
    pub fn frame_index_at(&self, seconds: f64) -> usize {
        if self.frames.len() == 1 || self.duration_ms == 0 {
            return 0;
        }
        let ms = ((seconds.max(0.0) * 1000.0) as u32) % self.duration_ms;
        self.cumulative_ms
            .iter()
            .position(|end| ms < *end)
            .unwrap_or(0)
            .min(self.frames.len() - 1)
    }

    pub fn is_animated(&self) -> bool {
        self.frames.len() > 1
    }

    pub fn dimensions(&self) -> (u32, u32) {
        self.frames
            .first()
            .map(|frame| (frame.width(), frame.height()))
            .unwrap_or((1, 1))
    }

    pub fn scaled_rgba(&self, max_width: i32, max_height: i32) -> ScaledAnimatedImage {
        let frames = self
            .frames
            .iter()
            .map(|frame| resize_to_rgba(frame, max_width, max_height))
            .collect();
        ScaledAnimatedImage {
            frames,
            cumulative_ms: self.cumulative_ms.clone(),
            duration_ms: self.duration_ms,
        }
    }
}

impl ScaledAnimatedImage {
    pub fn frame_at(&self, seconds: f64) -> &RgbaImage {
        &self.frames[self.frame_index_at(seconds)]
    }

    pub fn frame_index_at(&self, seconds: f64) -> usize {
        if self.frames.len() == 1 || self.duration_ms == 0 {
            return 0;
        }
        let ms = ((seconds.max(0.0) * 1000.0) as u32) % self.duration_ms;
        self.cumulative_ms
            .iter()
            .position(|end| ms < *end)
            .unwrap_or(0)
            .min(self.frames.len() - 1)
    }
}

pub struct EmoteCache {
    root: PathBuf,
    memory: HashMap<String, Option<AnimatedImage>>,
    client: reqwest::Client,
}

pub struct BadgeCache {
    root: PathBuf,
    memory: HashMap<String, Option<DynamicImage>>,
    client: reqwest::Client,
}

impl EmoteCache {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        Self {
            root,
            memory: HashMap::new(),
            client: reqwest::Client::new(),
        }
    }

    #[allow(dead_code)]
    pub async fn load(
        &mut self,
        provider: &str,
        id: &str,
        url: &str,
        queue: &std::sync::Arc<QueueManager>,
        job_id: &str,
    ) -> Option<AnimatedImage> {
        let key = format!("emote:{provider}:{id}:{url}");
        if let Some(img) = self.memory.get(&key) {
            return img.clone();
        }

        let path = cache_path(&self.root, provider, id, url);
        let image = load_or_download_animated(&self.client, &path, url)
            .await
            .map_err(|err| {
                emit_log(
                    queue,
                    job_id,
                    &format!("Chat overlay: emote {provider}/{id} unavailable: {err}"),
                );
                err
            })
            .ok();

        self.memory.insert(key, image.clone());
        image
    }

    pub fn get(&self, provider: &str, id: &str, url: &str) -> Option<&AnimatedImage> {
        self.memory
            .get(&format!("emote:{provider}:{id}:{url}"))
            .and_then(Option::as_ref)
    }

    pub async fn preload_many(
        &mut self,
        assets: Vec<(String, String, String)>,
        limit: usize,
        queue: &std::sync::Arc<QueueManager>,
        job_id: &str,
        progress_offset: usize,
        total_assets: usize,
    ) -> usize {
        let root = self.root.clone();
        let client = self.client.clone();
        let mut loaded = stream::iter(assets)
            .map(|(provider, id, url)| {
                let root = root.clone();
                let client = client.clone();
                async move {
                    let key = format!("emote:{provider}:{id}:{url}");
                    let path = cache_path(&root, &provider, &id, &url);
                    let image = load_or_download_animated(&client, &path, &url).await.ok();
                    (key, provider, id, image)
                }
            })
            .buffer_unordered(limit.max(1));

        let mut count = progress_offset;
        while let Some((key, provider, id, image)) = loaded.next().await {
            if image.is_none() {
                emit_log(
                    queue,
                    job_id,
                    &format!("Chat overlay: emote {provider}/{id} unavailable during preload"),
                );
            }
            self.memory.insert(key, image);
            count += 1;
            update_preload_progress(queue, job_id, count, total_assets);
        }
        count
    }
}

impl BadgeCache {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        Self {
            root,
            memory: HashMap::new(),
            client: reqwest::Client::new(),
        }
    }

    #[allow(dead_code)]
    pub async fn load(
        &mut self,
        provider: &str,
        id: &str,
        url: &str,
        queue: &std::sync::Arc<QueueManager>,
        job_id: &str,
    ) -> Option<DynamicImage> {
        let key = format!("badge:{provider}:{id}:{url}");
        if let Some(img) = self.memory.get(&key) {
            return img.clone();
        }

        let path = cache_path(&self.root, provider, id, url);
        let image = load_or_download_static(&self.client, &path, url)
            .await
            .map_err(|err| {
                emit_log(
                    queue,
                    job_id,
                    &format!("Chat overlay: badge {provider}/{id} unavailable: {err}"),
                );
                err
            })
            .ok();

        self.memory.insert(key, image.clone());
        image
    }

    pub fn get(&self, provider: &str, id: &str, url: &str) -> Option<&DynamicImage> {
        self.memory
            .get(&format!("badge:{provider}:{id}:{url}"))
            .and_then(Option::as_ref)
    }

    pub async fn preload_many(
        &mut self,
        assets: Vec<(String, String, String)>,
        limit: usize,
        queue: &std::sync::Arc<QueueManager>,
        job_id: &str,
        progress_offset: usize,
        total_assets: usize,
    ) -> usize {
        let root = self.root.clone();
        let client = self.client.clone();
        let mut loaded = stream::iter(assets)
            .map(|(provider, id, url)| {
                let root = root.clone();
                let client = client.clone();
                async move {
                    let key = format!("badge:{provider}:{id}:{url}");
                    let path = cache_path(&root, &provider, &id, &url);
                    let image = load_or_download_static(&client, &path, &url).await.ok();
                    (key, provider, id, image)
                }
            })
            .buffer_unordered(limit.max(1));

        let mut count = progress_offset;
        while let Some((key, provider, id, image)) = loaded.next().await {
            if image.is_none() {
                emit_log(
                    queue,
                    job_id,
                    &format!("Chat overlay: badge {provider}/{id} unavailable during preload"),
                );
            }
            self.memory.insert(key, image);
            count += 1;
            update_preload_progress(queue, job_id, count, total_assets);
        }
        count
    }
}

fn update_preload_progress(
    queue: &std::sync::Arc<QueueManager>,
    job_id: &str,
    loaded: usize,
    total: usize,
) {
    if total == 0 || (loaded % 25 != 0 && loaded != total) {
        return;
    }
    queue.set_progress(
        job_id,
        JobProgress {
            percent: 0.0,
            stage_percent: None,
            stage_start: None,
            stage_end: None,
            stage_started_at: None,
            download_elapsed_ms: None,
            speed: None,
            eta: None,
            size: None,
            message: Some(format!(
                "Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ° ÑÐ¼Ð¾Ñ‚Ð¾Ð²/Ð±ÐµÐ¹Ð´Ð¶ÐµÐ¹: {loaded}/{total}"
            )),
            ..JobProgress::default()
        },
    );
}

fn cache_path(root: &Path, provider: &str, id: &str, url: &str) -> PathBuf {
    let mut hasher = Sha1::new();
    hasher.update(url.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let ext = url
        .split('?')
        .next()
        .and_then(|u| u.rsplit('.').next())
        .filter(|ext| ext.len() <= 5)
        .unwrap_or("img");
    root.join(provider).join(format!("{id}-{hash}.{ext}"))
}

async fn load_or_download_static(
    client: &reqwest::Client,
    path: &Path,
    url: &str,
) -> Result<DynamicImage> {
    load_or_download_decoded(client, path, url, |bytes, label| {
        image::load_from_memory(bytes).with_context(|| format!("decode {label}"))
    })
    .await
}

async fn load_or_download_animated(
    client: &reqwest::Client,
    path: &Path,
    url: &str,
) -> Result<AnimatedImage> {
    match load_or_download_decoded(client, path, url, decode_animated).await {
        Ok(image) => Ok(image),
        Err(err) if is_7tv_cdn_url(url) => {
            let proxy_url = seven_tv_proxy_url(url);
            let proxy_path = path.with_file_name(format!(
                "{}.proxy",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("7tv.webp")
            ));
            load_or_download_decoded(client, &proxy_path, &proxy_url, decode_animated)
                .await
                .with_context(|| format!("7TV proxy fallback after {err}"))
        }
        Err(err) => Err(err),
    }
}

async fn load_or_download_decoded<T>(
    client: &reqwest::Client,
    path: &Path,
    url: &str,
    decode: impl Fn(&[u8], &str) -> Result<T>,
) -> Result<T> {
    if path.is_file() {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        match decode(&bytes, url) {
            Ok(value) => return Ok(value),
            Err(err) => {
                let _ = std::fs::remove_file(path);
                tracing::warn!(
                    "deleted corrupt chat asset cache {}: {err:#}",
                    path.display()
                );
            }
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = download_bytes(client, url).await?;
    std::fs::write(path, &bytes).with_context(|| format!("write {}", path.display()))?;
    decode(&bytes, url)
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("GET {url}"))?
        .bytes()
        .await
        .with_context(|| format!("read {url}"))
        .map(|bytes| bytes.to_vec())
}

fn is_7tv_cdn_url(url: &str) -> bool {
    url.contains("://cdn.7tv.app/")
}

fn seven_tv_proxy_url(url: &str) -> String {
    url.replace(
        "https://cdn.7tv.app",
        "https://7tv-imageproxy.twitcharchives.workers.dev",
    )
}

fn decode_animated(bytes: &[u8], label: &str) -> Result<AnimatedImage> {
    if let Ok(decoder) = GifDecoder::new(BufReader::new(Cursor::new(bytes))) {
        let frames = decoder.into_frames().collect_frames()?;
        return Ok(animated_from_frames(frames));
    }

    if let Ok(decoder) = WebPDecoder::new(BufReader::new(Cursor::new(bytes))) {
        let frames = decoder.into_frames().collect_frames()?;
        return Ok(animated_from_frames(frames));
    }

    image::load_from_memory(bytes)
        .map(AnimatedImage::from_static)
        .with_context(|| format!("decode {label}"))
}

fn animated_from_frames(frames: Vec<image::Frame>) -> AnimatedImage {
    let mut images = Vec::new();
    let mut cumulative_ms = Vec::new();
    let mut total = 0_u32;

    for frame in frames {
        let (num, den) = frame.delay().numer_denom_ms();
        let delay = if den == 0 { 100 } else { (num / den).max(20) };
        total = total.saturating_add(delay);
        cumulative_ms.push(total);
        images.push(DynamicImage::ImageRgba8(frame.into_buffer()));
    }

    if images.is_empty() {
        return AnimatedImage::from_static(DynamicImage::new_rgba8(1, 1));
    }

    AnimatedImage {
        frames: images,
        cumulative_ms,
        duration_ms: total.max(20),
    }
}

fn resize_to_rgba(image: &DynamicImage, max_width: i32, max_height: i32) -> RgbaImage {
    let max_w = max_width.max(1) as f32;
    let target_h = snap_resize_height(max_height.max(1), image.height().max(1), 4, 4) as f32;
    let scale = (max_w / image.width().max(1) as f32).min(target_h / image.height().max(1) as f32);
    let w = (image.width() as f32 * scale).round().max(1.0).min(max_w) as u32;
    let h = (image.height() as f32 * scale).round().max(1.0) as u32;
    image
        .resize_exact(w, h, imageops::FilterType::Lanczos3)
        .to_rgba8()
}

fn snap_resize_height(
    desired_height: i32,
    source_height: u32,
    up_snap_threshold: i32,
    down_snap_threshold: i32,
) -> i32 {
    let source_height = source_height.max(1) as i32;
    if up_snap_threshold == down_snap_threshold && up_snap_threshold != 0 {
        let remainder = (desired_height + up_snap_threshold) % source_height;
        if remainder <= up_snap_threshold * 2 {
            return desired_height + up_snap_threshold - remainder;
        }
    } else {
        if down_snap_threshold != 0 {
            let remainder = desired_height % source_height;
            if remainder <= down_snap_threshold {
                return desired_height - remainder;
            }
        }
        if up_snap_threshold != 0 {
            let remainder = source_height - (desired_height % source_height);
            if remainder <= up_snap_threshold {
                return desired_height + remainder;
            }
        }
    }
    desired_height
}

#[cfg(test)]
mod tests {
    use super::{cache_path, seven_tv_proxy_url, snap_resize_height};
    use std::path::Path;

    #[test]
    fn cache_path_is_stable_for_same_asset() {
        let root = Path::new("cache-root");
        let first = cache_path(root, "7tv", "abc", "https://cdn.7tv.app/emote/abc/2x.webp");
        let second = cache_path(root, "7tv", "abc", "https://cdn.7tv.app/emote/abc/2x.webp");
        assert_eq!(first, second);
    }

    #[test]
    fn seven_tv_proxy_replaces_only_cdn_host() {
        assert_eq!(
            seven_tv_proxy_url("https://cdn.7tv.app/emote/abc/2x.webp"),
            "https://7tv-imageproxy.twitcharchives.workers.dev/emote/abc/2x.webp"
        );
    }

    #[test]
    fn snap_resize_prefers_near_integer_height() {
        assert_eq!(snap_resize_height(38, 36, 4, 4), 36);
        assert_eq!(snap_resize_height(70, 36, 4, 4), 72);
    }
}
