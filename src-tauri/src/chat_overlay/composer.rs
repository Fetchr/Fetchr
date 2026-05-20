use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::chat_overlay::emit_log;
use crate::chat_overlay::settings::EffectiveChatOverlaySettings;
use crate::jobs::queue::QueueManager;
use crate::jobs::types::{
    BlurEffect, BlurZone, GpuEncoderMode, ImageFit, JobProgress, PerformanceSettings,
};

static RE_FFMPEG_TIME: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"time=(?P<t>\d{2}:\d{2}:\d{2}(?:\.\d+)?)").expect("ffmpeg time regex")
});

pub struct ChatOverlayComposer {
    settings: EffectiveChatOverlaySettings,
    ffmpeg: PathBuf,
    performance: PerformanceSettings,
    blur_zones: Vec<BlurZone>,
}

impl ChatOverlayComposer {
    pub fn new(
        settings: EffectiveChatOverlaySettings,
        ffmpeg: PathBuf,
        performance: PerformanceSettings,
        blur_zones: Vec<BlurZone>,
    ) -> Self {
        Self {
            settings,
            ffmpeg,
            performance: performance.with_defaults(),
            blur_zones,
        }
    }

    pub async fn compose(
        &self,
        input_video: &Path,
        overlay_video: &Path,
        output_video: &Path,
        duration: f64,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let mut last_error: Option<anyhow::Error> = None;
        for encoder in encoder_attempts(&self.performance) {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("cancelled"));
            }
            emit_log(
                queue,
                job_id,
                &format!("Chat overlay: composing with {}...", encoder.label),
            );
            match self
                .compose_with_encoder(
                    input_video,
                    overlay_video,
                    output_video,
                    duration,
                    queue,
                    job_id,
                    cancel.clone(),
                    &encoder,
                )
                .await
            {
                Ok(()) => return Ok(()),
                Err(err) if encoder.mode != GpuEncoderMode::Cpu => {
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
        Err(last_error.unwrap_or_else(|| anyhow!("no ffmpeg encoder attempts configured")))
    }

    async fn compose_with_encoder(
        &self,
        input_video: &Path,
        overlay_video: &Path,
        output_video: &Path,
        duration: f64,
        queue: &Arc<QueueManager>,
        job_id: &str,
        cancel: Arc<AtomicBool>,
        encoder: &EncoderAttempt,
    ) -> Result<()> {
        let zones = normalized_blur_zones(
            &self.blur_zones,
            self.settings.output_width,
            self.settings.output_height,
        );
        let filter = self.build_filter(&zones);

        let mut cmd = Command::new(&self.ffmpeg);
        cmd.kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .args(["-y", "-hide_banner", "-i"])
            .arg(input_video)
            .arg("-i")
            .arg(overlay_video);

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
        if let Some(threads) = self.performance.cpu_threads() {
            cmd.args(["-threads", &threads.to_string()]);
        }
        cmd.args(&encoder.args)
            .args(["-c:a", "copy", "-movflags", "+faststart", "-shortest"])
            .arg(output_video);

        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        emit_log(
            queue,
            job_id,
            &format!("$ {}", debug_cmd(&self.ffmpeg, &cmd)),
        );

        let mut child = cmd.spawn().context("spawn ffmpeg overlay composer")?;
        let stderr = child.stderr.take().context("stderr handle")?;
        let q = queue.clone();
        let id = job_id.to_string();
        let total_duration = duration.max(0.1);
        let started = Instant::now();
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(&q, &id, &format!("!! {line}"));
                if let Some(done_seconds) = parse_ffmpeg_time(&line) {
                    let ratio = (done_seconds / total_duration).clamp(0.0, 1.0);
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let eta = if ratio > 0.001 {
                        Some(format_duration(elapsed * (1.0 - ratio) / ratio))
                    } else {
                        None
                    };
                    q.set_progress(
                        &id,
                        JobProgress {
                            percent: 75.0 + (ratio as f32 * 25.0),
                            stage_percent: None,
                            stage_start: None,
                            stage_end: None,
                            stage_started_at: None,
                            download_elapsed_ms: None,
                            speed: None,
                            eta: eta.clone(),
                            size: None,
                            message: Some(format!(
                                "Compositing final video: {} / {}{}",
                                format_duration(done_seconds),
                                format_duration(total_duration),
                                eta.as_deref()
                                    .map(|value| format!(", ETA {value}"))
                                    .unwrap_or_default()
                            )),
                            ..JobProgress::default()
                        },
                    );
                }
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
                        return Err(anyhow!("ffmpeg overlay composer exited with {status}"));
                    }
                    break;
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
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
        emit_log(
            queue,
            job_id,
            &format!("Chat overlay saved: {}", output_video.display()),
        );
        Ok(())
    }

    fn build_filter(&self, zones: &[BlurZone]) -> String {
        if zones.is_empty()
            && self.settings.output_width == 1920
            && self.settings.output_height == 1080
            && self.settings.fps == 60
        {
            return format!(
                "[0:v][1:v]overlay={x}:{y}:format=auto[v]",
                x = self.settings.chat_x,
                y = self.settings.chat_y,
            );
        }
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
                    let image_filter = match zone.image_fit.unwrap_or(ImageFit::Contain) {
                        ImageFit::Contain => format!(
                            "[{input}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,format=rgba,\
pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0[zone{idx}];",
                            input = image_input,
                            w = zone.width,
                            h = zone.height,
                        ),
                        ImageFit::Cover => format!(
                            "[{input}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},format=rgba[zone{idx}];",
                            input = image_input,
                            w = zone.width,
                            h = zone.height,
                        ),
                        ImageFit::Stretch => format!(
                            "[{input}:v]scale={w}:{h},format=rgba[zone{idx}];",
                            input = image_input,
                            w = zone.width,
                            h = zone.height,
                        ),
                    };
                    filter.push_str(&image_filter);
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
        filter.push_str(&format!(
            "[{current}][1:v]overlay={x}:{y}:format=auto[v]",
            x = self.settings.chat_x,
            y = self.settings.chat_y,
        ));
        filter
    }
}

#[derive(Clone)]
struct EncoderAttempt {
    mode: GpuEncoderMode,
    label: &'static str,
    args: Vec<String>,
}

fn encoder_attempts(performance: &PerformanceSettings) -> Vec<EncoderAttempt> {
    let mode = performance.gpu_encoder_mode.unwrap_or(GpuEncoderMode::Auto);
    match mode {
        GpuEncoderMode::Auto => vec![
            gpu_attempt(GpuEncoderMode::IntelXeQsv, performance),
            gpu_attempt(GpuEncoderMode::Qsv, performance),
            gpu_attempt(GpuEncoderMode::Nvenc, performance),
            gpu_attempt(GpuEncoderMode::Amf, performance),
            cpu_attempt(performance),
        ],
        GpuEncoderMode::IntelXeQsv
        | GpuEncoderMode::Nvenc
        | GpuEncoderMode::Qsv
        | GpuEncoderMode::Amf => {
            vec![gpu_attempt(mode, performance), cpu_attempt(performance)]
        }
        GpuEncoderMode::Cpu => vec![cpu_attempt(performance)],
    }
}

fn cpu_attempt(performance: &PerformanceSettings) -> EncoderAttempt {
    EncoderAttempt {
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

fn gpu_attempt(mode: GpuEncoderMode, performance: &PerformanceSettings) -> EncoderAttempt {
    let preset = performance
        .ffmpeg_preset
        .clone()
        .filter(|v| !v.trim().is_empty());
    match mode {
        GpuEncoderMode::Nvenc => EncoderAttempt {
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
        GpuEncoderMode::IntelXeQsv | GpuEncoderMode::Qsv => EncoderAttempt {
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
        GpuEncoderMode::Amf => EncoderAttempt {
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
        GpuEncoderMode::Auto | GpuEncoderMode::Cpu => cpu_attempt(performance),
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
            Some(next)
        })
        .collect()
}

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let raw = RE_FFMPEG_TIME.captures(line)?.name("t")?.as_str();
    let mut parts = raw.split(':');
    let h = parts.next()?.parse::<f64>().ok()?;
    let m = parts.next()?.parse::<f64>().ok()?;
    let s = parts.next()?.parse::<f64>().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
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
