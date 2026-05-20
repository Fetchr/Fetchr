use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use ab_glyph::FontArc;
use anyhow::{anyhow, Context, Result};
use image::{imageops, DynamicImage, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use rayon::prelude::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::chat_overlay::cache::{BadgeCache, EmoteCache, ScaledAnimatedImage};
use crate::chat_overlay::emit_log;
use crate::chat_overlay::layout::{
    image_dimension_key, ChatLayoutEngine, LayoutMessage, LayoutRunKind, TextRole,
};
use crate::chat_overlay::model::{ChatFragment, ChatMessage};
use crate::chat_overlay::settings::{parse_color, EffectiveChatOverlaySettings};
use crate::jobs::queue::QueueManager;
use crate::jobs::types::{
    AlphaOutputFormat, BlurEffect, BlurZone, ChatFontStyle, ChatRenderCodec, GpuEncoderMode,
    ImageFit, JobProgress, PerformanceProfile, PerformanceSettings,
};

pub struct ChatOverlayRenderer {
    settings: EffectiveChatOverlaySettings,
    ffmpeg: PathBuf,
    work_dir: PathBuf,
    layout: ChatLayoutEngine,
    emotes: EmoteCache,
    badges: BadgeCache,
    text_font: FontArc,
    username_font: FontArc,
    render_workers: usize,
    asset_workers: usize,
    turbo: bool,
}

struct TimelineMessage {
    start: f64,
    end: f64,
    stable_key: String,
    prepared: PreparedMessage,
}

#[derive(Clone)]
struct PreparedMessage {
    height: u32,
    static_image: RgbaImage,
    animated_runs: Vec<PreparedAnimatedRun>,
}

#[derive(Clone)]
struct PreparedAnimatedRun {
    x: i32,
    y: i32,
    height: i32,
    frames: ScaledAnimatedImage,
}

struct FrameRenderPlan {
    index: usize,
    t: f64,
    visible: Vec<usize>,
    static_base: Arc<RgbaImage>,
    signature: String,
    reuse_previous: bool,
}

struct FrameRenderOutput {
    index: usize,
    signature: String,
    bytes: Option<Vec<u8>>,
}

impl ChatOverlayRenderer {
    pub fn new(
        settings: EffectiveChatOverlaySettings,
        ffmpeg: PathBuf,
        work_dir: PathBuf,
        render_workers: Option<u32>,
        performance_profile: Option<PerformanceProfile>,
        network_workers: Option<u32>,
    ) -> Result<Self> {
        let cache_root = dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("fetchr")
            .join("chat-assets");
        let text_font = load_font(
            &settings.font_family,
            settings.font_weight,
            settings.font_style,
        )
        .or_else(|| load_font("Segoe UI", 400, ChatFontStyle::Normal))
        .ok_or_else(|| anyhow!("No usable system font found for chat overlay"))?;
        let username_font = load_font(
            &settings.font_family,
            settings.username_font_weight,
            settings.username_font_style,
        )
        .or_else(|| load_font(&settings.font_family, 700, settings.font_style))
        .or_else(|| load_font("Segoe UI", 700, ChatFontStyle::Normal))
        .unwrap_or_else(|| text_font.clone());
        Ok(Self {
            layout: ChatLayoutEngine::new(settings.clone()),
            emotes: EmoteCache::new(cache_root.join("emotes")),
            badges: BadgeCache::new(cache_root.join("badges")),
            settings,
            ffmpeg,
            work_dir,
            text_font,
            username_font,
            render_workers: effective_render_workers(render_workers, performance_profile),
            asset_workers: effective_asset_workers(performance_profile, network_workers),
            turbo: performance_profile == Some(PerformanceProfile::Turbo),
        })
    }

    pub async fn render_to_mov(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        output: &Path,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        self.prepare_assets(messages, queue, job_id).await;
        match self
            .render_to_mov_pipe_parallel(messages, duration, output, queue, job_id, cancel.clone())
            .await
        {
            Ok(()) => Ok(()),
            Err(err) if !cancel.load(Ordering::SeqCst) => {
                emit_log(
                    queue,
                    job_id,
                    &format!(
                        "Chat overlay: pipe renderer failed ({err:#}); falling back to PNG sequence..."
                    ),
                );
                self.render_to_mov_png_sequence(messages, duration, output, queue, job_id, cancel)
                    .await
            }
            Err(err) => Err(err),
        }
    }

    pub async fn render_direct_outputs(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        input_video: &Path,
        alpha_output: Option<&Path>,
        final_output: &Path,
        performance: PerformanceSettings,
        blur_zones: &[BlurZone],
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        self.prepare_assets(messages, queue, job_id).await;
        let performance = performance.with_defaults();
        let mut last_error: Option<anyhow::Error> = None;
        for encoder in direct_encoder_attempts(&performance) {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            emit_log(
                queue,
                job_id,
                &format!("Chat overlay: direct compose with {}...", encoder.label),
            );
            match self
                .render_direct_with_encoder(
                    messages,
                    duration,
                    input_video,
                    alpha_output,
                    final_output,
                    &performance,
                    blur_zones,
                    queue,
                    job_id,
                    cancel.clone(),
                    &encoder,
                )
                .await
            {
                Ok(()) => return Ok(()),
                Err(err)
                    if encoder.mode != GpuEncoderMode::Cpu && !cancel.load(Ordering::SeqCst) =>
                {
                    emit_log(
                        queue,
                        job_id,
                        &format!(
                            "Chat overlay: {} failed ({err:#}); trying next encoder...",
                            encoder.label
                        ),
                    );
                    last_error = Some(err);
                }
                Err(err) => return Err(err),
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow!("no direct encoder attempts configured")))
    }

    async fn render_direct_with_encoder(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        input_video: &Path,
        alpha_output: Option<&Path>,
        final_output: &Path,
        performance: &PerformanceSettings,
        blur_zones: &[BlurZone],
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
        encoder: &DirectEncoderAttempt,
    ) -> Result<()> {
        let fps = self.settings.chat_overlay_fps.max(1);
        let total_frames = (duration.max(0.1) * fps as f64).ceil().max(1.0) as usize;
        let zones = normalized_blur_zones(
            blur_zones,
            self.settings.output_width,
            self.settings.output_height,
        );
        let filter = self.build_direct_filter(&zones, alpha_output.is_some());
        let mut cmd = Command::new(&self.ffmpeg);
        cmd.kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .args(["-y", "-hide_banner", "-i"])
            .arg(input_video)
            .args([
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                &format!("{}x{}", self.settings.chat_width, self.settings.chat_height),
                "-framerate",
                &fps.to_string(),
                "-i",
                "pipe:0",
            ]);

        for zone in zones
            .iter()
            .filter(|zone| zone.effect == BlurEffect::ImageOverlay)
        {
            if let Some(path) = zone
                .image_path
                .as_deref()
                .filter(|path| Path::new(path).is_file())
            {
                cmd.args(["-loop", "1", "-i"]).arg(path);
            }
        }

        cmd.args(["-filter_complex", &filter, "-map", "[v]", "-map", "0:a?"]);
        if let Some(threads) = performance.cpu_threads() {
            cmd.args(["-threads", &threads.to_string()]);
        }
        cmd.args(&encoder.args)
            .args(["-c:a", "copy", "-movflags", "+faststart", "-shortest"])
            .arg(final_output);

        if let Some(alpha) = alpha_output {
            cmd.args(["-map", "[chat_alpha]", "-an"]);
            cmd.args(alpha_encoder_args(self.settings.alpha_output_format));
            cmd.arg(alpha);
        }

        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        emit_log(
            queue,
            job_id,
            &format!("$ {}", debug_cmd(&self.ffmpeg, &cmd)),
        );
        let mut child = cmd.spawn().context("spawn ffmpeg direct composer")?;
        let mut stdin = child.stdin.take().context("ffmpeg stdin handle")?;
        let stderr = child.stderr.take().context("ffmpeg stderr handle")?;
        let prep_started = Instant::now();
        let timeline = self.build_timeline(messages);
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: message preparation time {}",
                format_duration(prep_started.elapsed().as_secs_f64())
            ),
        );
        let q = queue.clone();
        let id = job_id.to_string();
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(&q, &id, &format!("!! {line}"));
            }
        });

        let started = Instant::now();
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: direct Raw RGBA renderer using {} worker(s)",
                self.render_workers
            ),
        );
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(self.render_workers)
            .build()
            .context("create direct chat render worker pool")?;
        let batch_size = self.render_batch_size();
        let mut next_index = 0_usize;
        let mut active = VecDeque::<usize>::new();
        let mut cached_signature: Option<String> = None;
        let mut cached_frame: Option<Vec<u8>> = None;
        let mut static_base_signature: Option<String> = None;
        let mut static_base: Option<Arc<RgbaImage>> = None;
        let mut frame_idx = 0_usize;
        while frame_idx < total_frames {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }

            let end_frame = (frame_idx + batch_size).min(total_frames);
            let mut plans = Vec::with_capacity(end_frame - frame_idx);
            let mut planned_signature = cached_signature.clone();
            for idx in frame_idx..end_frame {
                let t = idx as f64 / fps as f64;
                while next_index < timeline.len() && timeline[next_index].start <= t {
                    active.push_back(next_index);
                    next_index += 1;
                }
                while active
                    .front()
                    .map(|idx| timeline[*idx].end < t)
                    .unwrap_or(false)
                {
                    active.pop_front();
                }
                let visible = visible_timeline_indices(&active, &timeline, &self.settings);
                let frame_static_signature =
                    static_timeline_signature(&visible, &timeline, &self.settings, t);
                if static_base_signature.as_deref() != Some(frame_static_signature.as_str()) {
                    static_base = Some(Arc::new(
                        self.render_static_timeline_frame(&visible, &timeline),
                    ));
                    static_base_signature = Some(frame_static_signature.clone());
                }
                let animated_signature = animated_timeline_signature(&visible, &timeline, t);
                let signature =
                    combined_timeline_signature(&frame_static_signature, &animated_signature);
                let reuse_previous = planned_signature.as_deref() == Some(signature.as_str());
                if !reuse_previous {
                    planned_signature = Some(signature.clone());
                }
                let static_base = static_base
                    .as_ref()
                    .expect("static chat frame should be initialized")
                    .clone();
                plans.push(FrameRenderPlan {
                    index: idx,
                    t,
                    visible,
                    static_base,
                    signature,
                    reuse_previous,
                });
            }
            cached_signature = planned_signature;

            let rendered = pool.install(|| {
                plans
                    .par_iter()
                    .map(|plan| {
                        if plan.reuse_previous {
                            FrameRenderOutput {
                                index: plan.index,
                                signature: plan.signature.clone(),
                                bytes: None,
                            }
                        } else {
                            let mut frame = (*plan.static_base).clone();
                            self.draw_timeline_animated(
                                &mut frame,
                                &plan.visible,
                                &timeline,
                                plan.t,
                            );
                            FrameRenderOutput {
                                index: plan.index,
                                signature: plan.signature.clone(),
                                bytes: Some(frame.into_raw()),
                            }
                        }
                    })
                    .collect::<Vec<_>>()
            });

            for frame in rendered {
                if cancel.load(Ordering::SeqCst) {
                    let _ = child.kill().await;
                    return Err(anyhow!("cancelled"));
                }

                if let Some(bytes) = frame.bytes {
                    stdin
                        .write_all(&bytes)
                        .await
                        .context("write direct chat frame to ffmpeg")?;
                    cached_signature = Some(frame.signature);
                    cached_frame = Some(bytes);
                } else {
                    let bytes = cached_frame
                        .as_ref()
                        .ok_or_else(|| anyhow!("chat frame cache is empty"))?;
                    stdin
                        .write_all(bytes)
                        .await
                        .context("write cached direct chat frame to ffmpeg")?;
                }

                if frame.index % fps as usize == 0 || frame.index + 1 == total_frames {
                    let done = frame.index + 1;
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let render_fps = done as f64 / elapsed;
                    let avg_ms = elapsed * 1000.0 / done as f64;
                    let eta = if render_fps > 0.01 {
                        Some(format_duration((total_frames - done) as f64 / render_fps))
                    } else {
                        None
                    };
                    queue.set_progress(
                        job_id,
                        JobProgress {
                            percent: (done as f32 / total_frames as f32) * 90.0,
                            stage_percent: None,
                            stage_start: None,
                            stage_end: None,
                            stage_started_at: None,
                            download_elapsed_ms: None,
                            speed: None,
                            eta: eta.clone(),
                            size: None,
                            message: Some(format!(
                                "Raw RGBA direct compose: {done}/{total_frames} frames, {render_fps:.1} fps, {avg_ms:.1} ms/frame, workers {}{}",
                                self.render_workers,
                                eta.as_deref()
                                    .map(|value| format!(", ETA {value}"))
                                    .unwrap_or_default()
                            )),
                            ..JobProgress::default()
                        },
                    );
                }
            }

            frame_idx = end_frame;
        }
        drop(stdin);

        let finalize_started = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            match child.try_wait()? {
                Some(status) => {
                    let _ = stderr_task.await;
                    if !status.success() {
                        return Err(anyhow!("ffmpeg direct composer exited with {status}"));
                    }
                    break;
                }
                None => {
                    let elapsed = finalize_started.elapsed().as_secs_f64();
                    queue.set_progress(
                        job_id,
                        JobProgress {
                            percent: 95.0,
                            stage_percent: None,
                            stage_start: None,
                            stage_end: None,
                            stage_started_at: None,
                            download_elapsed_ms: None,
                            speed: None,
                            eta: None,
                            size: None,
                            message: Some(format!(
                                "Finalizing video: {}",
                                format_duration(elapsed)
                            )),
                            ..JobProgress::default()
                        },
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                }
            }
        }

        queue.set_progress(
            job_id,
            JobProgress {
                percent: 100.0,
                stage_percent: None,
                stage_start: None,
                stage_end: None,
                stage_started_at: None,
                download_elapsed_ms: None,
                speed: None,
                eta: None,
                size: None,
                message: Some("Chat overlay composed".to_string()),
                ..JobProgress::default()
            },
        );
        Ok(())
    }

    fn build_direct_filter(&self, zones: &[BlurZone], save_alpha: bool) -> String {
        let mut filter = format!(
            "[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease,\
pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},setsar=1[base0];",
            w = self.settings.output_width,
            h = self.settings.output_height,
            fps = self.settings.fps,
        );
        let mut current = "base0".to_string();
        let mut image_input = 2;
        for (idx, zone) in zones.iter().enumerate() {
            let next = format!("base{}", idx + 1);
            match zone.effect {
                BlurEffect::GaussianBlur => {
                    let sigma = zone.intensity.clamp(1.0, 64.0);
                    filter.push_str(&format!(
                        "[{current}]split=2[{current}m][{current}c];\
[{current}c]crop={w}:{h}:{x}:{y},gblur=sigma={sigma:.1}[zone{idx}];\
[{current}m][zone{idx}]overlay={x}:{y}[{next}];",
                        w = zone.width,
                        h = zone.height,
                        x = zone.x,
                        y = zone.y,
                    ));
                }
                BlurEffect::Mosaic => {
                    let factor = zone.intensity.round().clamp(2.0, 80.0) as u32;
                    let down_w = (zone.width / factor).max(1);
                    let down_h = (zone.height / factor).max(1);
                    filter.push_str(&format!(
                        "[{current}]split=2[{current}m][{current}c];\
[{current}c]crop={w}:{h}:{x}:{y},scale={dw}:{dh}:flags=neighbor,scale={w}:{h}:flags=neighbor[zone{idx}];\
[{current}m][zone{idx}]overlay={x}:{y}[{next}];",
                        w = zone.width,
                        h = zone.height,
                        x = zone.x,
                        y = zone.y,
                        dw = down_w,
                        dh = down_h,
                    ));
                }
                BlurEffect::ImageOverlay => {
                    if zone
                        .image_path
                        .as_deref()
                        .filter(|path| Path::new(path).is_file())
                        .is_none()
                    {
                        continue;
                    }
                    filter.push_str(&image_fit_filter(
                        image_input,
                        idx,
                        zone.width,
                        zone.height,
                        zone.image_fit.unwrap_or(ImageFit::Contain),
                    ));
                    filter.push_str(&format!(
                        "[{current}][zone{idx}]overlay={x}:{y}[{next}];",
                        x = zone.x,
                        y = zone.y,
                    ));
                    image_input += 1;
                }
            }
            current = next;
        }
        if save_alpha {
            filter.push_str(&format!(
                "[1:v]format=rgba,split[chat_for_overlay][chat_alpha];\
[{current}][chat_for_overlay]overlay={x}:{y}:format=auto[v]",
                x = self.settings.chat_x,
                y = self.settings.chat_y,
            ));
        } else {
            filter.push_str(&format!(
                "[1:v]format=rgba[chat_for_overlay];\
[{current}][chat_for_overlay]overlay={x}:{y}:format=auto[v]",
                x = self.settings.chat_x,
                y = self.settings.chat_y,
            ));
        }
        filter
    }

    async fn render_to_mov_pipe_parallel(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        output: &Path,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let fps = self.settings.chat_overlay_fps.max(1);
        let total_frames = (duration.max(0.1) * fps as f64).ceil().max(1.0) as usize;
        let prep_started = Instant::now();
        let timeline = self.build_timeline(messages);
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: message preparation time {}",
                format_duration(prep_started.elapsed().as_secs_f64())
            ),
        );
        let mut child = self
            .spawn_raw_overlay_encoder(output, fps, queue, job_id)
            .await?;
        let mut stdin = child.stdin.take().context("ffmpeg stdin handle")?;
        let stderr = child.stderr.take().context("ffmpeg stderr handle")?;
        let q = queue.clone();
        let id = job_id.to_string();
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(&q, &id, &format!("!! {line}"));
            }
        });

        let started = Instant::now();
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: MOV RLE frame renderer using {} worker(s)",
                self.render_workers
            ),
        );
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(self.render_workers)
            .build()
            .context("create chat overlay render worker pool")?;
        let batch_size = self.render_batch_size();
        let mut next_index = 0_usize;
        let mut active = VecDeque::<usize>::new();
        let mut cached_signature: Option<String> = None;
        let mut cached_frame: Option<Vec<u8>> = None;
        let mut static_base_signature: Option<String> = None;
        let mut static_base: Option<Arc<RgbaImage>> = None;
        let mut frame_idx = 0_usize;

        while frame_idx < total_frames {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }

            let end_frame = (frame_idx + batch_size).min(total_frames);
            let mut plans = Vec::with_capacity(end_frame - frame_idx);
            let mut planned_signature = cached_signature.clone();
            for idx in frame_idx..end_frame {
                let t = idx as f64 / fps as f64;
                while next_index < timeline.len() && timeline[next_index].start <= t {
                    active.push_back(next_index);
                    next_index += 1;
                }
                while active
                    .front()
                    .map(|idx| timeline[*idx].end < t)
                    .unwrap_or(false)
                {
                    active.pop_front();
                }
                let visible = visible_timeline_indices(&active, &timeline, &self.settings);
                let frame_static_signature =
                    static_timeline_signature(&visible, &timeline, &self.settings, t);
                if static_base_signature.as_deref() != Some(frame_static_signature.as_str()) {
                    static_base = Some(Arc::new(
                        self.render_static_timeline_frame(&visible, &timeline),
                    ));
                    static_base_signature = Some(frame_static_signature.clone());
                }
                let animated_signature = animated_timeline_signature(&visible, &timeline, t);
                let signature =
                    combined_timeline_signature(&frame_static_signature, &animated_signature);
                let reuse_previous = planned_signature.as_deref() == Some(signature.as_str());
                if !reuse_previous {
                    planned_signature = Some(signature.clone());
                }
                let static_base = static_base
                    .as_ref()
                    .expect("static chat frame should be initialized")
                    .clone();
                plans.push(FrameRenderPlan {
                    index: idx,
                    t,
                    visible,
                    static_base,
                    signature,
                    reuse_previous,
                });
            }
            cached_signature = planned_signature;

            let rendered = pool.install(|| {
                plans
                    .par_iter()
                    .map(|plan| {
                        if plan.reuse_previous {
                            FrameRenderOutput {
                                index: plan.index,
                                signature: plan.signature.clone(),
                                bytes: None,
                            }
                        } else {
                            let mut frame = (*plan.static_base).clone();
                            self.draw_timeline_animated(
                                &mut frame,
                                &plan.visible,
                                &timeline,
                                plan.t,
                            );
                            FrameRenderOutput {
                                index: plan.index,
                                signature: plan.signature.clone(),
                                bytes: Some(frame.into_raw()),
                            }
                        }
                    })
                    .collect::<Vec<_>>()
            });

            for frame in rendered {
                if cancel.load(Ordering::SeqCst) {
                    let _ = child.kill().await;
                    return Err(anyhow!("cancelled"));
                }

                if let Some(bytes) = frame.bytes {
                    stdin
                        .write_all(&bytes)
                        .await
                        .context("write chat overlay frame to ffmpeg")?;
                    cached_signature = Some(frame.signature);
                    cached_frame = Some(bytes);
                } else {
                    let bytes = cached_frame
                        .as_ref()
                        .ok_or_else(|| anyhow!("chat frame cache is empty"))?;
                    stdin
                        .write_all(bytes)
                        .await
                        .context("write cached chat overlay frame to ffmpeg")?;
                }

                if frame.index % fps as usize == 0 || frame.index + 1 == total_frames {
                    let done = frame.index + 1;
                    let percent = (done as f32 / total_frames as f32) * 75.0;
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let render_fps = done as f64 / elapsed;
                    let avg_ms = elapsed * 1000.0 / done as f64;
                    let eta = if render_fps > 0.01 {
                        Some(format_duration((total_frames - done) as f64 / render_fps))
                    } else {
                        None
                    };
                    queue.set_progress(
                        job_id,
                            JobProgress {
                                percent,
                                stage_percent: None,
                                stage_start: None,
                                stage_end: None,
                                stage_started_at: None,
                                download_elapsed_ms: None,
                                speed: None,
                                eta: eta.clone(),
                            size: None,
                            message: Some(format!(
                                "Ð ÐµÐ½Ð´ÐµÑ€ MOV RLE Ñ‡Ð°Ñ‚Ð°: {done}/{total_frames} ÐºÐ°Ð´Ñ€Ð¾Ð², {render_fps:.1} fps, {avg_ms:.1} ms/frame, workers {}{}",
                                self.render_workers,
                                eta.as_deref()
                                    .map(|value| format!(", Ð¾ÑÑ‚Ð°Ð»Ð¾ÑÑŒ {value}"))
                                    .unwrap_or_default()
                            )),
                            ..JobProgress::default()
                        },
                    );
                }
            }

            frame_idx = end_frame;
        }

        drop(stdin);

        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            match child.try_wait()? {
                Some(status) => {
                    let _ = stderr_task.await;
                    if !status.success() {
                        return Err(anyhow!("ffmpeg overlay encoder exited with {status}"));
                    }
                    break;
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }

        queue.set_progress(
            job_id,
            JobProgress {
                percent: 75.0,
                stage_percent: None,
                stage_start: None,
                stage_end: None,
                stage_started_at: None,
                download_elapsed_ms: None,
                speed: None,
                eta: None,
                size: None,
                message: Some("MOV RLE Ñ‡Ð°Ñ‚ Ð¾Ñ‚Ñ€ÐµÐ½Ð´ÐµÑ€ÐµÐ½".to_string()),
                ..JobProgress::default()
            },
        );
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: overlay render time {}",
                format_duration(started.elapsed().as_secs_f64())
            ),
        );
        Ok(())
    }

    #[allow(dead_code)]
    async fn render_to_mov_pipe(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        output: &Path,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let fps = self.settings.chat_overlay_fps.max(1);
        let total_frames = (duration.max(0.1) * fps as f64).ceil().max(1.0) as usize;
        let prep_started = Instant::now();
        let timeline = self.build_timeline(messages);
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: message preparation time {}",
                format_duration(prep_started.elapsed().as_secs_f64())
            ),
        );
        let mut child = self
            .spawn_raw_overlay_encoder(output, fps, queue, job_id)
            .await?;
        let mut stdin = child.stdin.take().context("ffmpeg stdin handle")?;
        let stderr = child.stderr.take().context("ffmpeg stderr handle")?;
        let q = queue.clone();
        let id = job_id.to_string();
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(&q, &id, &format!("!! {line}"));
            }
        });

        let started = Instant::now();
        let mut next_index = 0_usize;
        let mut active = VecDeque::<usize>::new();
        let mut cached_signature: Option<String> = None;
        let mut cached_frame: Option<Vec<u8>> = None;
        let mut static_base_signature: Option<String> = None;
        let mut static_base: Option<Arc<RgbaImage>> = None;
        for frame_idx in 0..total_frames {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            let t = frame_idx as f64 / fps as f64;
            while next_index < timeline.len() && timeline[next_index].start <= t {
                active.push_back(next_index);
                next_index += 1;
            }
            while active
                .front()
                .map(|idx| timeline[*idx].end < t)
                .unwrap_or(false)
            {
                active.pop_front();
            }
            let visible = visible_timeline_indices(&active, &timeline, &self.settings);
            let frame_static_signature =
                static_timeline_signature(&visible, &timeline, &self.settings, t);
            if static_base_signature.as_deref() != Some(frame_static_signature.as_str()) {
                static_base = Some(Arc::new(
                    self.render_static_timeline_frame(&visible, &timeline),
                ));
                static_base_signature = Some(frame_static_signature.clone());
            }
            let animated_signature = animated_timeline_signature(&visible, &timeline, t);
            let signature =
                combined_timeline_signature(&frame_static_signature, &animated_signature);
            if cached_signature.as_deref() == Some(signature.as_str()) {
                let bytes = cached_frame
                    .as_ref()
                    .ok_or_else(|| anyhow!("chat frame cache is empty"))?;
                stdin
                    .write_all(bytes)
                    .await
                    .context("write cached chat overlay frame to ffmpeg")?;
            } else {
                let mut frame = static_base
                    .as_ref()
                    .ok_or_else(|| anyhow!("static chat frame cache is empty"))?
                    .as_ref()
                    .clone();
                self.draw_timeline_animated(&mut frame, &visible, &timeline, t);
                let bytes = frame.into_raw();
                stdin
                    .write_all(&bytes)
                    .await
                    .context("write chat overlay frame to ffmpeg")?;
                cached_signature = Some(signature);
                cached_frame = Some(bytes);
            }

            if frame_idx % fps as usize == 0 || frame_idx + 1 == total_frames {
                let done = frame_idx + 1;
                let percent = (done as f32 / total_frames as f32) * 75.0;
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let render_fps = done as f64 / elapsed;
                let avg_ms = elapsed * 1000.0 / done as f64;
                let eta = if render_fps > 0.01 {
                    Some(format_duration((total_frames - done) as f64 / render_fps))
                } else {
                    None
                };
                queue.set_progress(
                    job_id,
                        JobProgress {
                            percent,
                            stage_percent: None,
                            stage_start: None,
                            stage_end: None,
                            stage_started_at: None,
                            download_elapsed_ms: None,
                            speed: None,
                            eta: eta.clone(),
                        size: None,
                        message: Some(format!(
                            "Ð ÐµÐ½Ð´ÐµÑ€ MOV RLE Ñ‡Ð°Ñ‚Ð°: {done}/{total_frames} ÐºÐ°Ð´Ñ€Ð¾Ð², {render_fps:.1} fps, {avg_ms:.1} ms/frame{}",
                            eta.as_deref()
                                .map(|value| format!(", Ð¾ÑÑ‚Ð°Ð»Ð¾ÑÑŒ {value}"))
                                .unwrap_or_default()
                        )),
                        ..JobProgress::default()
                    },
                );
            }
        }

        drop(stdin);

        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            match child.try_wait()? {
                Some(status) => {
                    let _ = stderr_task.await;
                    if !status.success() {
                        return Err(anyhow!("ffmpeg overlay encoder exited with {status}"));
                    }
                    break;
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }

        queue.set_progress(
            job_id,
            JobProgress {
                percent: 75.0,
                stage_percent: None,
                stage_start: None,
                stage_end: None,
                stage_started_at: None,
                download_elapsed_ms: None,
                speed: None,
                eta: None,
                size: None,
                message: Some("MOV RLE Ñ‡Ð°Ñ‚ Ð¾Ñ‚Ñ€ÐµÐ½Ð´ÐµÑ€ÐµÐ½".to_string()),
                ..JobProgress::default()
            },
        );
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: overlay render time {}",
                format_duration(started.elapsed().as_secs_f64())
            ),
        );
        Ok(())
    }

    async fn render_to_mov_png_sequence(
        &mut self,
        messages: &[ChatMessage],
        duration: f64,
        output: &Path,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let frames_dir = self.work_dir.join("frames");
        if frames_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&frames_dir);
        }
        std::fs::create_dir_all(&frames_dir)
            .with_context(|| format!("create {}", frames_dir.display()))?;

        let fps = self.settings.chat_overlay_fps.max(1);
        let total_frames = (duration.max(0.1) * fps as f64).ceil().max(1.0) as usize;
        let prep_started = Instant::now();
        let timeline = self.build_timeline(messages);
        emit_log(
            queue,
            job_id,
            &format!(
                "Chat overlay: message preparation time {}",
                format_duration(prep_started.elapsed().as_secs_f64())
            ),
        );
        let started = Instant::now();
        let mut next_index = 0_usize;
        let mut active = VecDeque::<usize>::new();
        let mut cached_signature: Option<String> = None;
        let mut cached_frame: Option<RgbaImage> = None;
        let mut static_base_signature: Option<String> = None;
        let mut static_base: Option<Arc<RgbaImage>> = None;
        for frame_idx in 0..total_frames {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            let t = frame_idx as f64 / fps as f64;
            while next_index < timeline.len() && timeline[next_index].start <= t {
                active.push_back(next_index);
                next_index += 1;
            }
            while active
                .front()
                .map(|idx| timeline[*idx].end < t)
                .unwrap_or(false)
            {
                active.pop_front();
            }
            let visible = visible_timeline_indices(&active, &timeline, &self.settings);
            let frame_static_signature =
                static_timeline_signature(&visible, &timeline, &self.settings, t);
            if static_base_signature.as_deref() != Some(frame_static_signature.as_str()) {
                static_base = Some(Arc::new(
                    self.render_static_timeline_frame(&visible, &timeline),
                ));
                static_base_signature = Some(frame_static_signature.clone());
            }
            let animated_signature = animated_timeline_signature(&visible, &timeline, t);
            let signature =
                combined_timeline_signature(&frame_static_signature, &animated_signature);
            let frame = if cached_signature.as_deref() == Some(signature.as_str()) {
                cached_frame
                    .as_ref()
                    .ok_or_else(|| anyhow!("chat PNG frame cache is empty"))?
                    .clone()
            } else {
                let mut frame = static_base
                    .as_ref()
                    .ok_or_else(|| anyhow!("static chat frame cache is empty"))?
                    .as_ref()
                    .clone();
                self.draw_timeline_animated(&mut frame, &visible, &timeline, t);
                cached_signature = Some(signature);
                cached_frame = Some(frame.clone());
                frame
            };
            let path = frames_dir.join(format!("frame_{frame_idx:06}.png"));
            frame
                .save(&path)
                .with_context(|| format!("save {}", path.display()))?;

            if frame_idx % fps as usize == 0 || frame_idx + 1 == total_frames {
                let done = frame_idx + 1;
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let render_fps = done as f64 / elapsed;
                let avg_ms = elapsed * 1000.0 / done as f64;
                let eta = if render_fps > 0.01 {
                    Some(format_duration((total_frames - done) as f64 / render_fps))
                } else {
                    None
                };
                queue.set_progress(
                    job_id,
                    JobProgress {
                        percent: (done as f32 / total_frames as f32) * 70.0,
                        stage_percent: None,
                        stage_start: None,
                        stage_end: None,
                        stage_started_at: None,
                        download_elapsed_ms: None,
                        speed: None,
                        eta: eta.clone(),
                        size: None,
                        message: Some(format!(
                            "Rendering chat PNG frames: {done}/{total_frames}, {render_fps:.1} fps, {avg_ms:.1} ms/frame{}",
                            eta.as_deref()
                                .map(|value| format!(", ETA {value}"))
                                .unwrap_or_default()
                        )),
                        ..JobProgress::default()
                    },
                );
            }
        }

        self.encode_mov_from_frames(&frames_dir, output, queue, job_id, cancel)
            .await
    }

    async fn prepare_assets(
        &mut self,
        messages: &[ChatMessage],
        queue: &Arc<QueueManager>,
        job_id: &str,
    ) {
        let mut unique_badges = HashSet::new();
        let mut unique_emotes = HashSet::new();
        for message in messages {
            if self.settings.show_badges {
                for badge in &message.badges {
                    if let Some(url) = badge.url.as_deref() {
                        unique_badges.insert((
                            badge.provider.clone(),
                            badge.id.clone(),
                            url.to_string(),
                        ));
                    }
                }
            }
            for fragment in &message.fragments {
                if let ChatFragment::Emote {
                    provider, id, url, ..
                } = fragment
                {
                    unique_emotes.insert((provider.clone(), id.clone(), url.clone()));
                }
            }
        }

        let total_assets = unique_badges.len() + unique_emotes.len();
        if total_assets > 0 {
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
                    message: Some(format!("Preparing emotes/badges: 0/{total_assets}")),
                    ..JobProgress::default()
                },
            );
        }
        let started = Instant::now();
        let preload_limit = self.asset_workers;
        if total_assets > 0 {
            emit_log(
                queue,
                job_id,
                &format!(
                    "Chat overlay: preloading {total_assets} emote/badge assets with {preload_limit} worker(s)"
                ),
            );
        }
        let loaded_assets = self
            .badges
            .preload_many(
                unique_badges.into_iter().collect(),
                preload_limit,
                queue,
                job_id,
                0,
                total_assets,
            )
            .await;
        self.emotes
            .preload_many(
                unique_emotes.into_iter().collect(),
                preload_limit,
                queue,
                job_id,
                loaded_assets,
                total_assets,
            )
            .await;
        self.layout
            .set_image_dimensions(self.loaded_image_dimensions(messages));
        if total_assets > 0 {
            update_asset_progress(queue, job_id, total_assets, total_assets);
            emit_log(
                queue,
                job_id,
                &format!(
                    "Chat overlay: asset preload time {}",
                    format_duration(started.elapsed().as_secs_f64())
                ),
            );
        }
    }

    fn loaded_image_dimensions(&self, messages: &[ChatMessage]) -> HashMap<String, (u32, u32)> {
        let mut dimensions = HashMap::new();
        for message in messages {
            if self.settings.show_badges {
                for badge in &message.badges {
                    let Some(url) = badge.url.as_deref() else {
                        continue;
                    };
                    if let Some(image) = self.badges.get(&badge.provider, &badge.id, url) {
                        dimensions.insert(
                            image_dimension_key(&badge.provider, &badge.id, url, true),
                            (image.width(), image.height()),
                        );
                    }
                }
            }
            for fragment in &message.fragments {
                let ChatFragment::Emote {
                    provider, id, url, ..
                } = fragment
                else {
                    continue;
                };
                if let Some(image) = self.emotes.get(provider, id, url) {
                    dimensions.insert(
                        image_dimension_key(provider, id, url, false),
                        image.dimensions(),
                    );
                }
            }
        }
        dimensions
    }

    fn build_timeline(&mut self, messages: &[ChatMessage]) -> Vec<TimelineMessage> {
        let mut timeline = Vec::with_capacity(messages.len());
        for message in messages {
            let layout = self
                .layout
                .layout_message(message, &self.text_font, &self.username_font);
            let prepared = self.prepare_message_bitmap(&layout);
            timeline.push(TimelineMessage {
                start: message.timestamp,
                end: message.timestamp + self.settings.message_lifetime_sec,
                stable_key: message.stable_key(),
                prepared,
            });
        }
        timeline.sort_by(|a, b| a.start.total_cmp(&b.start));
        timeline
    }

    fn prepare_message_bitmap(&self, layout: &LayoutMessage) -> PreparedMessage {
        let mut static_image =
            RgbaImage::from_pixel(self.settings.chat_width, layout.height, Rgba([0, 0, 0, 0]));
        let mut animated_runs = Vec::new();
        self.draw_layout_static_prepared(&mut static_image, layout, &mut animated_runs);
        PreparedMessage {
            height: layout.height,
            static_image,
            animated_runs,
        }
    }

    fn render_static_timeline_frame(
        &self,
        visible: &[usize],
        timeline: &[TimelineMessage],
    ) -> RgbaImage {
        let mut canvas = RgbaImage::from_pixel(
            self.settings.chat_width,
            self.settings.chat_height,
            Rgba([0, 0, 0, 0]),
        );

        if self.settings.render_codec == ChatRenderCodec::SolidBgFast {
            let color = parse_color(&self.settings.solid_background_color, [33, 33, 33, 255]);
            for pixel in canvas.pixels_mut() {
                *pixel = Rgba([color[0], color[1], color[2], 255]);
            }
        } else if self.settings.background_enabled {
            let alpha = (self.settings.background_opacity.clamp(0.0, 1.0) * 255.0) as u8;
            for pixel in canvas.pixels_mut() {
                *pixel = Rgba([0, 0, 0, alpha]);
            }
        }

        for (idx, y) in message_positions(visible, timeline, &self.settings) {
            imageops::overlay(
                &mut canvas,
                &timeline[idx].prepared.static_image,
                0,
                y.max(0) as i64,
            );
        }

        canvas
    }

    fn draw_timeline_animated(
        &self,
        canvas: &mut RgbaImage,
        visible: &[usize],
        timeline: &[TimelineMessage],
        t: f64,
    ) {
        for (idx, y) in message_positions(visible, timeline, &self.settings) {
            for run in &timeline[idx].prepared.animated_runs {
                let frame = run.frames.frame_at(t);
                draw_rgba_image(canvas, frame, run.x, y + run.y, run.height);
            }
        }
    }

    fn draw_layout_static_prepared(
        &self,
        canvas: &mut RgbaImage,
        layout: &LayoutMessage,
        animated_runs: &mut Vec<PreparedAnimatedRun>,
    ) {
        let scale = self.settings.font_size;
        let outline_color = parse_color(&self.settings.outline_color, [0, 0, 0, 255]);
        for run in &layout.runs {
            let x = run.x;
            let y = run.y;
            match &run.kind {
                LayoutRunKind::Text { text, role } => {
                    let font = if *role == TextRole::Username {
                        &self.username_font
                    } else {
                        &self.text_font
                    };
                    if self.settings.outline_enabled && self.settings.outline_thickness > 0 {
                        let radius = self.settings.outline_thickness as i32;
                        for oy in -radius..=radius {
                            for ox in -radius..=radius {
                                if ox == 0 && oy == 0 {
                                    continue;
                                }
                                draw_text_mut(
                                    canvas,
                                    Rgba(outline_color),
                                    x + ox,
                                    y + oy,
                                    scale,
                                    font,
                                    text,
                                );
                            }
                        }
                    }
                    draw_text_mut(canvas, Rgba(run.color), x, y, scale, font, text);
                }
                LayoutRunKind::Image {
                    provider,
                    id,
                    url,
                    placeholder,
                    is_badge,
                    ..
                } => {
                    if *is_badge {
                        if let Some(img) = self.badges.get(provider, id, url) {
                            let img = resize_image_to_rgba(img, run.width, run.height);
                            draw_rgba_image(canvas, &img, x, y, run.height);
                        } else {
                            self.draw_placeholder(canvas, placeholder, x, y, scale);
                        }
                    } else if let Some(animated) = self.emotes.get(provider, id, url) {
                        let frames = animated.scaled_rgba(run.width, run.height);
                        if animated.is_animated() {
                            animated_runs.push(PreparedAnimatedRun {
                                x,
                                y,
                                height: run.height,
                                frames,
                            });
                        } else {
                            draw_rgba_image(canvas, frames.frame_at(0.0), x, y, run.height);
                        }
                    } else {
                        self.draw_placeholder(canvas, placeholder, x, y, scale);
                    }
                }
            }
        }
    }

    #[allow(dead_code)]
    async fn render_frame(
        &mut self,
        messages: &[ChatMessage],
        t: f64,
        queue: &Arc<QueueManager>,
        job_id: &str,
    ) -> RgbaImage {
        let mut canvas = RgbaImage::from_pixel(
            self.settings.chat_width,
            self.settings.chat_height,
            Rgba([0, 0, 0, 0]),
        );

        if self.settings.background_enabled {
            let alpha = (self.settings.background_opacity.clamp(0.0, 1.0) * 255.0) as u8;
            for pixel in canvas.pixels_mut() {
                *pixel = Rgba([0, 0, 0, alpha]);
            }
        }

        let visible: Vec<&ChatMessage> = messages
            .iter()
            .filter(|message| {
                message.timestamp <= t
                    && t - message.timestamp <= self.settings.message_lifetime_sec
            })
            .rev()
            .take(self.settings.max_visible_messages)
            .collect();

        let gap = 8_i32;
        if self.settings.direction == "bottom-up" {
            let mut cursor_y = self.settings.chat_height as i32;
            for message in visible {
                let layout =
                    self.layout
                        .layout_message(message, &self.text_font, &self.username_font);
                cursor_y -= layout.height as i32;
                if cursor_y < 0 {
                    break;
                }
                self.draw_layout(&mut canvas, &layout, 0, cursor_y, t, queue, job_id)
                    .await;
                cursor_y -= gap;
            }
        } else {
            let mut cursor_y = 0_i32;
            for message in visible.into_iter().rev() {
                let layout =
                    self.layout
                        .layout_message(message, &self.text_font, &self.username_font);
                if cursor_y + layout.height as i32 > self.settings.chat_height as i32 {
                    break;
                }
                self.draw_layout(&mut canvas, &layout, 0, cursor_y, t, queue, job_id)
                    .await;
                cursor_y += layout.height as i32 + gap;
            }
        }

        canvas
    }

    #[allow(dead_code)]
    async fn draw_layout(
        &mut self,
        canvas: &mut RgbaImage,
        layout: &LayoutMessage,
        offset_x: i32,
        offset_y: i32,
        t: f64,
        queue: &Arc<QueueManager>,
        job_id: &str,
    ) {
        let scale = self.settings.font_size;
        let outline_color = parse_color(&self.settings.outline_color, [0, 0, 0, 255]);
        for run in &layout.runs {
            let x = offset_x + run.x;
            let y = offset_y + run.y;
            match &run.kind {
                LayoutRunKind::Text { text, role } => {
                    let font = if *role == TextRole::Username {
                        &self.username_font
                    } else {
                        &self.text_font
                    };
                    if self.settings.outline_enabled && self.settings.outline_thickness > 0 {
                        let radius = self.settings.outline_thickness as i32;
                        for oy in -radius..=radius {
                            for ox in -radius..=radius {
                                if ox == 0 && oy == 0 {
                                    continue;
                                }
                                draw_text_mut(
                                    canvas,
                                    Rgba(outline_color),
                                    x + ox,
                                    y + oy,
                                    scale,
                                    font,
                                    text,
                                );
                            }
                        }
                    }
                    draw_text_mut(canvas, Rgba(run.color), x, y, scale, font, text);
                }
                LayoutRunKind::Image {
                    provider,
                    id,
                    url,
                    placeholder,
                    is_badge,
                    ..
                } => {
                    if *is_badge {
                        if let Some(img) = self.badges.load(provider, id, url, queue, job_id).await
                        {
                            draw_image(canvas, &img, x, y, run.width, run.height);
                        } else {
                            self.draw_placeholder(canvas, placeholder, x, y, scale);
                        }
                    } else if let Some(animated) =
                        self.emotes.load(provider, id, url, queue, job_id).await
                    {
                        draw_image(canvas, animated.frame_at(t), x, y, run.width, run.height);
                    } else {
                        self.draw_placeholder(canvas, placeholder, x, y, scale);
                    }
                }
            }
        }
    }

    fn draw_placeholder(
        &self,
        canvas: &mut RgbaImage,
        placeholder: &str,
        x: i32,
        y: i32,
        scale: f32,
    ) {
        let text = format!("[{placeholder}]");
        draw_text_mut(
            canvas,
            Rgba([255, 255, 255, 255]),
            x,
            y,
            scale,
            &self.text_font,
            &text,
        );
    }

    async fn spawn_raw_overlay_encoder(
        &self,
        output: &Path,
        fps: u32,
        queue: &Arc<QueueManager>,
        job_id: &str,
    ) -> Result<tokio::process::Child> {
        let size = format!("{}x{}", self.settings.chat_width, self.settings.chat_height);
        let mut cmd = Command::new(&self.ffmpeg);
        cmd.kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .args([
                "-y",
                "-hide_banner",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                &size,
                "-framerate",
                &fps.to_string(),
                "-i",
                "pipe:0",
            ])
            .args(alpha_encoder_args(self.settings.alpha_output_format))
            .arg(output);

        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        emit_log(
            queue,
            job_id,
            &format!("$ {}", debug_cmd(&self.ffmpeg, &cmd)),
        );
        cmd.spawn().context("spawn ffmpeg overlay encoder")
    }

    async fn encode_mov_from_frames(
        &self,
        frames_dir: &Path,
        output: &Path,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let pattern = frames_dir.join("frame_%06d.png");
        let mut cmd = Command::new(&self.ffmpeg);
        cmd.kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .args([
                "-y",
                "-hide_banner",
                "-framerate",
                &self.settings.chat_overlay_fps.to_string(),
                "-i",
            ])
            .arg(&pattern)
            .args(alpha_encoder_args(self.settings.alpha_output_format))
            .arg(output);

        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        emit_log(
            queue,
            job_id,
            &format!("$ {}", debug_cmd(&self.ffmpeg, &cmd)),
        );
        let mut child = cmd.spawn().context("spawn ffmpeg overlay encoder")?;
        let stderr = child.stderr.take().context("stderr handle")?;
        let q = queue.clone();
        let id = job_id.to_string();
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(&q, &id, &format!("!! {line}"));
            }
        });

        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill().await;
                return Err(anyhow!("cancelled"));
            }
            match child.try_wait()? {
                Some(status) => {
                    let _ = stderr_task.await;
                    if !status.success() {
                        return Err(anyhow!("ffmpeg overlay encoder exited with {status}"));
                    }
                    break;
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }

        queue.set_progress(
            job_id,
            JobProgress {
                percent: 75.0,
                stage_percent: None,
                stage_start: None,
                stage_end: None,
                stage_started_at: None,
                download_elapsed_ms: None,
                speed: None,
                eta: None,
                size: None,
                message: Some("Transparent chat overlay encoded".to_string()),
                ..JobProgress::default()
            },
        );
        Ok(())
    }

    fn render_batch_size(&self) -> usize {
        let multiplier = if self.turbo { 8 } else { 4 };
        let max = if self.turbo { 192 } else { 64 };
        (self.render_workers * multiplier).clamp(4, max)
    }
}

#[allow(dead_code)]
fn draw_image(
    canvas: &mut RgbaImage,
    image: &DynamicImage,
    x: i32,
    y: i32,
    max_width: i32,
    max_height: i32,
) {
    let resized = resize_image_to_rgba(image, max_width, max_height);
    draw_rgba_image(canvas, &resized, x, y, max_height);
}

fn resize_image_to_rgba(image: &DynamicImage, max_width: i32, max_height: i32) -> RgbaImage {
    let (w, h) = scaled_dimensions_fit(image, max_width, max_height);
    image
        .resize_exact(w, h, imageops::FilterType::Lanczos3)
        .to_rgba8()
}

fn draw_rgba_image(canvas: &mut RgbaImage, image: &RgbaImage, x: i32, y: i32, max_height: i32) {
    let centered_y = y + ((max_height - image.height() as i32) / 2).max(0);
    imageops::overlay(canvas, image, x.max(0) as i64, centered_y.max(0) as i64);
}

fn update_asset_progress(queue: &Arc<QueueManager>, job_id: &str, loaded: usize, total: usize) {
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
            message: Some(format!("Preparing emotes/badges: {loaded}/{total}")),
            ..JobProgress::default()
        },
    );
}

#[derive(Clone)]
struct DirectEncoderAttempt {
    mode: GpuEncoderMode,
    label: &'static str,
    args: Vec<String>,
}

fn direct_encoder_attempts(performance: &PerformanceSettings) -> Vec<DirectEncoderAttempt> {
    let mode = performance.gpu_encoder_mode.unwrap_or(GpuEncoderMode::Auto);
    match mode {
        GpuEncoderMode::Auto => vec![
            direct_gpu_attempt(GpuEncoderMode::IntelXeQsv, performance),
            direct_gpu_attempt(GpuEncoderMode::Qsv, performance),
            direct_gpu_attempt(GpuEncoderMode::Nvenc, performance),
            direct_gpu_attempt(GpuEncoderMode::Amf, performance),
            direct_cpu_attempt(performance),
        ],
        GpuEncoderMode::IntelXeQsv
        | GpuEncoderMode::Qsv
        | GpuEncoderMode::Nvenc
        | GpuEncoderMode::Amf => {
            vec![
                direct_gpu_attempt(mode, performance),
                direct_cpu_attempt(performance),
            ]
        }
        GpuEncoderMode::Cpu => vec![direct_cpu_attempt(performance)],
    }
}

fn direct_cpu_attempt(performance: &PerformanceSettings) -> DirectEncoderAttempt {
    DirectEncoderAttempt {
        mode: GpuEncoderMode::Cpu,
        label: "CPU libx264",
        args: vec![
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            "18".into(),
            "-preset".into(),
            performance
                .ffmpeg_preset
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "medium".into()),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ],
    }
}

fn direct_gpu_attempt(
    mode: GpuEncoderMode,
    performance: &PerformanceSettings,
) -> DirectEncoderAttempt {
    let preset = performance
        .ffmpeg_preset
        .clone()
        .filter(|v| !v.trim().is_empty());
    match mode {
        GpuEncoderMode::IntelXeQsv | GpuEncoderMode::Qsv => DirectEncoderAttempt {
            mode,
            label: if mode == GpuEncoderMode::IntelXeQsv {
                "Intel Xe Quick Sync"
            } else {
                "Intel Quick Sync"
            },
            args: vec![
                "-c:v".into(),
                "h264_qsv".into(),
                "-preset".into(),
                preset.unwrap_or_else(|| "veryfast".into()),
                "-async_depth".into(),
                "8".into(),
                "-global_quality".into(),
                "18".into(),
                "-pix_fmt".into(),
                "nv12".into(),
            ],
        },
        GpuEncoderMode::Nvenc => DirectEncoderAttempt {
            mode,
            label: "NVIDIA NVENC",
            args: vec![
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                preset.unwrap_or_else(|| "p4".into()),
                "-cq".into(),
                "18".into(),
                "-b:v".into(),
                "0".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
        },
        GpuEncoderMode::Amf => DirectEncoderAttempt {
            mode,
            label: "AMD AMF",
            args: vec![
                "-c:v".into(),
                "h264_amf".into(),
                "-quality".into(),
                preset.unwrap_or_else(|| "speed".into()),
                "-qp_i".into(),
                "18".into(),
                "-qp_p".into(),
                "18".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
        },
        GpuEncoderMode::Auto | GpuEncoderMode::Cpu => direct_cpu_attempt(performance),
    }
}

fn alpha_encoder_args(format: AlphaOutputFormat) -> Vec<String> {
    match format {
        AlphaOutputFormat::MovQtrle => vec![
            "-c:v".into(),
            "qtrle".into(),
            "-pix_fmt".into(),
            "argb".into(),
        ],
        AlphaOutputFormat::WebmVp9 => vec![
            "-c:v".into(),
            "libvpx-vp9".into(),
            "-pix_fmt".into(),
            "yuva420p".into(),
            "-lossless".into(),
            "1".into(),
            "-deadline".into(),
            "realtime".into(),
            "-cpu-used".into(),
            "6".into(),
            "-row-mt".into(),
            "1".into(),
        ],
        AlphaOutputFormat::WebmVp8 => vec![
            "-c:v".into(),
            "libvpx".into(),
            "-pix_fmt".into(),
            "yuva420p".into(),
            "-deadline".into(),
            "realtime".into(),
            "-cpu-used".into(),
            "6".into(),
        ],
        AlphaOutputFormat::Ffv1Mkv => vec![
            "-c:v".into(),
            "ffv1".into(),
            "-level".into(),
            "3".into(),
            "-pix_fmt".into(),
            "rgba".into(),
        ],
        AlphaOutputFormat::Prores4444 => vec![
            "-c:v".into(),
            "prores_ks".into(),
            "-profile:v".into(),
            "4444".into(),
            "-pix_fmt".into(),
            "yuva444p10le".into(),
        ],
        AlphaOutputFormat::LagarithAvi => vec![
            "-c:v".into(),
            "lagarith".into(),
            "-pix_fmt".into(),
            "rgba".into(),
        ],
    }
}

fn image_fit_filter(input: usize, idx: usize, width: u32, height: u32, fit: ImageFit) -> String {
    match fit {
        ImageFit::Contain => format!(
            "[{input}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,format=rgba,\
pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0[zone{idx}];"
        ),
        ImageFit::Cover => format!(
            "[{input}:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=rgba[zone{idx}];"
        ),
        ImageFit::Stretch => {
            format!("[{input}:v]scale={width}:{height},format=rgba[zone{idx}];")
        }
    }
}

fn normalized_blur_zones(zones: &[BlurZone], width: u32, height: u32) -> Vec<BlurZone> {
    zones
        .iter()
        .filter(|zone| zone.enabled && zone.width > 0 && zone.height > 0)
        .filter_map(|zone| {
            let x = zone.x.clamp(0, width.saturating_sub(1) as i32);
            let y = zone.y.clamp(0, height.saturating_sub(1) as i32);
            let max_w = width.saturating_sub(x as u32);
            let max_h = height.saturating_sub(y as u32);
            let w = zone.width.min(max_w);
            let h = zone.height.min(max_h);
            if w == 0 || h == 0 {
                return None;
            }
            let mut next = zone.clone();
            next.x = x;
            next.y = y;
            next.width = w;
            next.height = h;
            next.intensity = next.intensity.max(1.0);
            next.image_fit.get_or_insert(ImageFit::Contain);
            Some(next)
        })
        .collect()
}

fn visible_timeline_indices(
    active: &VecDeque<usize>,
    timeline: &[TimelineMessage],
    settings: &EffectiveChatOverlaySettings,
) -> Vec<usize> {
    let mut visible = active
        .iter()
        .rev()
        .take(settings.max_visible_messages)
        .copied()
        .collect::<Vec<_>>();
    visible.retain(|idx| timeline.get(*idx).is_some());
    visible
}

fn message_positions(
    visible: &[usize],
    timeline: &[TimelineMessage],
    settings: &EffectiveChatOverlaySettings,
) -> Vec<(usize, i32)> {
    let gap = 8_i32;
    let mut positions = Vec::with_capacity(visible.len());
    if settings.direction == "bottom-up" {
        let mut cursor_y = settings.chat_height as i32;
        for idx in visible {
            let Some(message) = timeline.get(*idx) else {
                continue;
            };
            cursor_y -= message.prepared.height as i32;
            if cursor_y < 0 {
                break;
            }
            positions.push((*idx, cursor_y));
            cursor_y -= gap;
        }
    } else {
        let mut cursor_y = 0_i32;
        for idx in visible.iter().rev() {
            let Some(message) = timeline.get(*idx) else {
                continue;
            };
            if cursor_y + message.prepared.height as i32 > settings.chat_height as i32 {
                break;
            }
            positions.push((*idx, cursor_y));
            cursor_y += message.prepared.height as i32 + gap;
        }
    }
    positions
}

fn static_timeline_signature(
    visible: &[usize],
    timeline: &[TimelineMessage],
    settings: &EffectiveChatOverlaySettings,
    t: f64,
) -> String {
    let mut signature = String::new();
    let cadence = settings.chat_update_rate_sec;
    if cadence > 0.0 {
        signature.push_str(&format!("cadence:{}|", (t / cadence).floor() as u64));
    }
    for idx in visible {
        let Some(message) = timeline.get(*idx) else {
            continue;
        };
        signature.push_str(&message.stable_key);
        signature.push('|');
    }
    signature
}

fn animated_timeline_signature(visible: &[usize], timeline: &[TimelineMessage], t: f64) -> String {
    let mut signature = String::new();
    for idx in visible {
        let Some(message) = timeline.get(*idx) else {
            continue;
        };
        for (run_idx, run) in message.prepared.animated_runs.iter().enumerate() {
            signature.push_str(&idx.to_string());
            signature.push(':');
            signature.push_str(&run_idx.to_string());
            signature.push(':');
            signature.push_str(&run.frames.frame_index_at(t).to_string());
            signature.push('|');
        }
    }
    signature
}

fn combined_timeline_signature(static_signature: &str, animated_signature: &str) -> String {
    if animated_signature.is_empty() {
        static_signature.to_string()
    } else {
        format!("{static_signature}anim|{animated_signature}")
    }
}

fn scaled_dimensions_fit(image: &DynamicImage, max_width: i32, max_height: i32) -> (u32, u32) {
    let max_w = max_width.max(1) as f32;
    let max_h = max_height.max(1) as f32;
    let scale = (max_w / image.width().max(1) as f32).min(max_h / image.height().max(1) as f32);
    (
        (image.width() as f32 * scale).round().max(1.0) as u32,
        (image.height() as f32 * scale).round().max(1.0) as u32,
    )
}

fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn effective_render_workers(
    configured: Option<u32>,
    performance_profile: Option<PerformanceProfile>,
) -> usize {
    if let Some(value) = configured.filter(|value| *value > 0) {
        return value.clamp(1, 64) as usize;
    }
    if performance_profile == Some(PerformanceProfile::Turbo) {
        return std::thread::available_parallelism()
            .map(|cores| cores.get().clamp(2, 64))
            .unwrap_or(8);
    }
    std::thread::available_parallelism()
        .map(|cores| cores.get().saturating_sub(1).max(2).min(12))
        .unwrap_or(4)
}

fn effective_asset_workers(
    performance_profile: Option<PerformanceProfile>,
    network_workers: Option<u32>,
) -> usize {
    match performance_profile.unwrap_or(PerformanceProfile::Auto) {
        PerformanceProfile::Auto => 8,
        PerformanceProfile::Maximum => 16,
        PerformanceProfile::Turbo | PerformanceProfile::Custom => {
            network_workers.unwrap_or(32).clamp(1, 32) as usize
        }
    }
}

fn load_font(family: &str, weight: u16, style: ChatFontStyle) -> Option<FontArc> {
    if let Some(font) = load_fontdb(family, weight, style) {
        return Some(font);
    }
    let windows = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let font_dir = windows.join("Fonts");
    let mut candidates = Vec::new();
    let f = family.to_ascii_lowercase();
    if f.contains("inter") {
        candidates.extend([
            font_dir.join("Inter.ttf"),
            font_dir.join("Inter-Regular.ttf"),
            font_dir.join("InterVariable.ttf"),
        ]);
    }
    if weight >= 600 {
        candidates.extend([
            font_dir.join("segoeuib.ttf"),
            font_dir.join("arialbd.ttf"),
            font_dir.join("tahomabd.ttf"),
        ]);
    }
    candidates.extend([
        font_dir.join("segoeui.ttf"),
        font_dir.join("arial.ttf"),
        font_dir.join("tahoma.ttf"),
    ]);

    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(font) = FontArc::try_from_vec(bytes) {
                return Some(font);
            }
        }
    }
    None
}

fn load_fontdb(family: &str, weight: u16, style: ChatFontStyle) -> Option<FontArc> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let query = fontdb::Query {
        families: &[fontdb::Family::Name(family)],
        weight: fontdb::Weight(weight),
        stretch: fontdb::Stretch::Normal,
        style: fontdb_style(style),
    };
    let id = db.query(&query)?;
    let face = db.face(id)?;
    match &face.source {
        fontdb::Source::File(path) => std::fs::read(path)
            .ok()
            .and_then(|bytes| FontArc::try_from_vec(bytes).ok()),
        fontdb::Source::Binary(bytes) => {
            FontArc::try_from_vec(bytes.as_ref().as_ref().to_vec()).ok()
        }
        fontdb::Source::SharedFile(path, _) => std::fs::read(path)
            .ok()
            .and_then(|bytes| FontArc::try_from_vec(bytes).ok()),
    }
}

fn fontdb_style(style: ChatFontStyle) -> fontdb::Style {
    match style {
        ChatFontStyle::Normal => fontdb::Style::Normal,
        ChatFontStyle::Italic => fontdb::Style::Italic,
        ChatFontStyle::Oblique => fontdb::Style::Oblique,
    }
}

fn debug_cmd(bin: &Path, cmd: &Command) -> String {
    let std = cmd.as_std();
    let mut out = quote_arg(bin.to_string_lossy().as_ref());
    for a in std.get_args() {
        out.push(' ');
        out.push_str(&quote_arg(a.to_string_lossy().as_ref()));
    }
    out
}

fn quote_arg(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".into();
    }
    if s.chars().any(|c| c == ' ' || c == '"') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}
