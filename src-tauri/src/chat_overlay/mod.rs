pub mod cache;
pub mod composer;
pub mod kick_live;
pub mod layout;
pub mod model;
pub mod providers;
pub mod renderer;
pub mod settings;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};

use crate::binaries::{resolve_binary, FFMPEG, YTDLP};
use crate::chat_overlay::kick_live::is_kick_live_channel_url;
use crate::jobs::queue::QueueManager;
use crate::jobs::types::{
    AlphaOutputFormat, ChatComposeMode, ChatRenderCodec, Job, JobProgress, Mode,
};

use self::composer::ChatOverlayComposer;
use self::model::{read_chat_messages, write_chat_messages};
use self::providers::provider_for_job;
use self::renderer::ChatOverlayRenderer;
use self::settings::EffectiveChatOverlaySettings;

pub async fn render_and_compose_for_video(
    queue: &Arc<QueueManager>,
    job: &Job,
    input_video: &Path,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
) -> Result<PathBuf> {
    let total_started = Instant::now();
    let settings = job
        .spec
        .chat_overlay
        .clone()
        .unwrap_or_default()
        .with_defaults();
    let mut effective = EffectiveChatOverlaySettings::from(settings.clone());
    apply_render_codec_defaults(&mut effective);

    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found - set binaries folder in Settings"))?;
    let ytdlp = resolve_binary(YTDLP, bin_dir);

    let stem = input_video
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let work_dir = input_video
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{stem}.chat_overlay"));
    std::fs::create_dir_all(&work_dir).with_context(|| format!("create {}", work_dir.display()))?;

    emit_log(queue, &job.id, "Chat overlay: preparing chat source...");
    queue.set_progress_stage(
        &job.id,
        60.0,
        64.0,
        Some("Preparing chat source".to_string()),
    );
    queue.set_progress(
        &job.id,
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
            message: Some("Preparing chat source".to_string()),
            ..JobProgress::default()
        },
    );

    let chat_json = work_dir.join("chat.json");
    let chat_started = Instant::now();
    let recorded_messages =
        if let Some(recorded_chat) = find_recorded_chat_for_video(job, input_video) {
            emit_log(
                queue,
                &job.id,
                &format!(
                    "Chat overlay: using recorded chat sidecar {}",
                    recorded_chat.display()
                ),
            );
            if let Some(messages) = read_non_empty_recorded_chat(&recorded_chat)
                .with_context(|| format!("read recorded chat {}", recorded_chat.display()))?
            {
                write_chat_messages(&chat_json, &messages)
                    .with_context(|| format!("write {}", chat_json.display()))?;
                Some(messages)
            } else {
                if is_kick_live_job(job) {
                    return Err(anyhow!(
                        "recorded Kick live chat sidecar is empty: {}",
                        recorded_chat.display()
                    ));
                }
                emit_log(
                    queue,
                    &job.id,
                    &format!(
                        "!! Chat overlay: recorded Kick chat sidecar is empty, ignoring {}",
                        recorded_chat.display()
                    ),
                );
                None
            }
        } else {
            None
        };
    let mut messages = if let Some(messages) = recorded_messages {
        messages
    } else if is_kick_live_job(job) {
        return Err(anyhow!(
            "recorded Kick live chat sidecar was not found for {}. The live recorder did not capture chat.",
            input_video.display()
        ));
    } else {
        emit_log(queue, &job.id, "Chat overlay: downloading chat replay...");
        queue.set_progress_stage(
            &job.id,
            64.0,
            72.0,
            Some("Downloading chat replay".to_string()),
        );
        let provider = provider_for_job(job, ytdlp);
        provider
            .download_chat(job, &effective, &chat_json, queue, cancel.clone())
            .await
            .map_err(|err| anyhow!("download chat replay: {err:#}"))?
    };
    emit_log(
        queue,
        &job.id,
        &format!(
            "Chat overlay: chat download time {}",
            format_duration(chat_started.elapsed().as_secs_f64())
        ),
    );

    if cancel.load(Ordering::SeqCst) {
        return Err(anyhow!("cancelled"));
    }

    queue.set_progress_stage(
        &job.id,
        72.0,
        74.0,
        Some("Normalizing chat timestamps".to_string()),
    );
    let trim_start = parse_hms(job.spec.start.as_deref()).unwrap_or(0.0);
    let trim_end = parse_hms(job.spec.end.as_deref());
    let duration = trim_end
        .map(|end| (end - trim_start).max(0.0))
        .or(job.spec.meta.duration)
        .or_else(|| infer_duration_from_messages(&messages, &effective));

    normalize_chat_timestamps(&mut messages, trim_start, duration);
    if messages.is_empty() {
        return Err(anyhow!(
            "chat source is empty after timestamp normalization"
        ));
    }
    self::model::write_chat_messages(&chat_json, &messages)
        .with_context(|| format!("write {}", chat_json.display()))?;

    let alpha_overlay = input_video.with_file_name(format!(
        "{stem}_chat_overlay.{}",
        alpha_extension(effective.alpha_output_format)
    ));
    let render_duration = duration.unwrap_or_else(|| {
        messages
            .last()
            .map(|m| m.timestamp + effective.message_lifetime_sec)
            .unwrap_or(effective.message_lifetime_sec)
    });

    emit_log(
        queue,
        &job.id,
        &format!("Chat overlay: rendering transparent layer ({render_duration:.1}s)..."),
    );
    queue.set_progress_stage(
        &job.id,
        74.0,
        96.0,
        Some("Rendering chat frames".to_string()),
    );
    queue.set_progress(
        &job.id,
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
            message: Some("Rendering chat overlay".to_string()),
            ..JobProgress::default()
        },
    );

    let performance = job
        .spec
        .performance
        .clone()
        .unwrap_or_default()
        .with_defaults();
    let mut renderer = ChatOverlayRenderer::new(
        effective.clone(),
        ffmpeg.clone(),
        work_dir.clone(),
        performance.render_workers,
        performance.profile,
        Some(performance.network_threads()),
    )?;
    let output_video = input_video.with_file_name(format!("{stem}_chat.mp4"));
    let compose_blur_zones = job.spec.blur_zones.clone();

    if effective.compose_mode == ChatComposeMode::Direct {
        queue.set_progress_stage(
            &job.id,
            74.0,
            100.0,
            Some("Direct render: video + blur + chat".to_string()),
        );
        let direct_started = Instant::now();
        renderer
            .render_direct_outputs(
                &messages,
                render_duration,
                input_video,
                effective
                    .save_alpha_overlay
                    .then_some(alpha_overlay.as_path()),
                &output_video,
                performance,
                &compose_blur_zones,
                queue,
                &job.id,
                cancel,
            )
            .await?;
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: direct total time {}",
                format_duration(direct_started.elapsed().as_secs_f64())
            ),
        );
    } else {
        queue.set_progress_stage(
            &job.id,
            74.0,
            88.0,
            Some("Rendering chat alpha overlay".to_string()),
        );
        let overlay_started = Instant::now();
        renderer
            .render_to_mov(
                &messages,
                render_duration,
                &alpha_overlay,
                queue,
                &job.id,
                cancel.clone(),
            )
            .await?;
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: MOV overlay stage time {}",
                format_duration(overlay_started.elapsed().as_secs_f64())
            ),
        );

        if cancel.load(Ordering::SeqCst) {
            return Err(anyhow!("cancelled"));
        }

        emit_log(queue, &job.id, "Chat overlay: composing final MP4...");
        queue.set_progress_stage(
            &job.id,
            88.0,
            100.0,
            Some("Compositing final video".to_string()),
        );
        queue.set_progress(
            &job.id,
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
                message: Some("Compositing chat overlay".to_string()),
                ..JobProgress::default()
            },
        );

        let composer = ChatOverlayComposer::new(effective, ffmpeg, performance, compose_blur_zones);
        let compose_started = Instant::now();
        composer
            .compose(
                input_video,
                &alpha_overlay,
                &output_video,
                render_duration,
                queue,
                &job.id,
                cancel,
            )
            .await?;
        emit_log(
            queue,
            &job.id,
            &format!(
                "Chat overlay: compose time {}",
                format_duration(compose_started.elapsed().as_secs_f64())
            ),
        );
    }

    emit_log(
        queue,
        &job.id,
        &format!(
            "Chat overlay: total with chat {}",
            format_duration(total_started.elapsed().as_secs_f64())
        ),
    );
    Ok(output_video)
}

pub async fn download_and_render_chat_only(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
) -> Result<PathBuf> {
    let total_started = Instant::now();
    let settings = job
        .spec
        .chat_overlay
        .clone()
        .unwrap_or_default()
        .with_defaults();
    let mut effective = EffectiveChatOverlaySettings::from(settings);
    apply_render_codec_defaults(&mut effective);

    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found - set binaries folder in Settings"))?;
    let ytdlp = resolve_binary(YTDLP, bin_dir);
    let output_dir = PathBuf::from(&job.spec.directory);
    std::fs::create_dir_all(&output_dir)
        .with_context(|| format!("create {}", output_dir.display()))?;

    let stem = sanitize_file_stem(&job.spec.name);
    let work_dir = output_dir.join(format!("{stem}.chat_overlay"));
    std::fs::create_dir_all(&work_dir).with_context(|| format!("create {}", work_dir.display()))?;

    emit_log(queue, &job.id, "Chat-only: downloading chat replay...");
    queue.set_progress(
        &job.id,
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
            message: Some("Downloading chat replay".to_string()),
            ..JobProgress::default()
        },
    );

    let provider = provider_for_job(job, ytdlp);
    let chat_json = output_dir.join(format!("{stem}_chat.json"));
    let cache_json = work_dir.join("chat.json");
    let mut messages = provider
        .download_chat(job, &effective, &cache_json, queue, cancel.clone())
        .await
        .map_err(|err| anyhow!("download chat replay: {err:#}"))?;

    if cancel.load(Ordering::SeqCst) {
        return Err(anyhow!("cancelled"));
    }

    let trim_start = parse_hms(job.spec.start.as_deref()).unwrap_or(0.0);
    let trim_end = parse_hms(job.spec.end.as_deref());
    let duration = trim_end
        .map(|end| (end - trim_start).max(0.0))
        .or(job.spec.meta.duration)
        .or_else(|| infer_duration_from_messages(&messages, &effective));
    normalize_chat_timestamps(&mut messages, trim_start, duration);
    self::model::write_chat_messages(&chat_json, &messages)
        .with_context(|| format!("write {}", chat_json.display()))?;

    let render_duration = duration.unwrap_or_else(|| {
        messages
            .last()
            .map(|m| m.timestamp + effective.message_lifetime_sec)
            .unwrap_or(effective.message_lifetime_sec)
    });
    let output = output_dir.join(format!(
        "{stem}_chat_overlay.{}",
        alpha_extension(effective.alpha_output_format)
    ));

    emit_log(
        queue,
        &job.id,
        &format!("Chat-only: rendering transparent layer ({render_duration:.1}s)..."),
    );
    queue.set_progress_stage(
        &job.id,
        10.0,
        100.0,
        Some("Rendering chat overlay".to_string()),
    );
    queue.set_progress(
        &job.id,
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
            message: Some("Rendering chat overlay".to_string()),
            ..JobProgress::default()
        },
    );

    let performance = job
        .spec
        .performance
        .clone()
        .unwrap_or_default()
        .with_defaults();
    let mut renderer = ChatOverlayRenderer::new(
        effective,
        ffmpeg,
        work_dir,
        performance.render_workers,
        performance.profile,
        Some(performance.network_threads()),
    )?;
    renderer
        .render_to_mov(&messages, render_duration, &output, queue, &job.id, cancel)
        .await?;

    emit_log(
        queue,
        &job.id,
        &format!(
            "Chat-only: saved {} and {} in {}",
            output.display(),
            chat_json.display(),
            format_duration(total_started.elapsed().as_secs_f64())
        ),
    );
    Ok(output)
}

pub async fn render_chat_json_file(
    queue: &Arc<QueueManager>,
    chat_json: &Path,
    output_dir: &Path,
    output_name: &str,
    settings: crate::jobs::types::ChatOverlaySettings,
    performance: crate::jobs::types::PerformanceSettings,
    bin_dir: Option<&Path>,
) -> Result<PathBuf> {
    let performance = performance.with_defaults();
    let mut effective = EffectiveChatOverlaySettings::from(settings.with_defaults());
    apply_render_codec_defaults(&mut effective);
    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found - set binaries folder in Settings"))?;

    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("create {}", output_dir.display()))?;
    let stem = sanitize_file_stem(output_name);
    let work_dir = output_dir.join(format!("{stem}.chat_overlay"));
    std::fs::create_dir_all(&work_dir).with_context(|| format!("create {}", work_dir.display()))?;

    let mut messages =
        read_chat_messages(chat_json).with_context(|| format!("read {}", chat_json.display()))?;
    messages.retain(|message| message.timestamp >= 0.0);
    messages.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
    if messages.is_empty() {
        return Err(anyhow!("chat source is empty"));
    }

    let cache_json = work_dir.join("chat.json");
    write_chat_messages(&cache_json, &messages)
        .with_context(|| format!("write {}", cache_json.display()))?;

    let render_duration = infer_duration_from_messages(&messages, &effective)
        .unwrap_or(effective.message_lifetime_sec);
    let output = output_dir.join(format!(
        "{stem}_chat_overlay.{}",
        alpha_extension(effective.alpha_output_format)
    ));

    let job_id = format!("kick_chat_render:{stem}");
    emit_log(
        queue,
        &job_id,
        &format!(
            "Chat JSON render: rendering {} messages ({render_duration:.1}s)...",
            messages.len()
        ),
    );

    let mut renderer = ChatOverlayRenderer::new(
        effective,
        ffmpeg,
        work_dir,
        performance.render_workers,
        performance.profile,
        Some(performance.network_threads()),
    )?;
    renderer
        .render_to_mov(
            &messages,
            render_duration,
            &output,
            queue,
            &job_id,
            Arc::new(AtomicBool::new(false)),
        )
        .await?;

    Ok(output)
}

fn alpha_extension(format: AlphaOutputFormat) -> &'static str {
    match format {
        AlphaOutputFormat::MovQtrle => "mov",
        AlphaOutputFormat::WebmVp9 | AlphaOutputFormat::WebmVp8 => "webm",
        AlphaOutputFormat::Ffv1Mkv => "mkv",
        AlphaOutputFormat::Prores4444 => "mov",
        AlphaOutputFormat::LagarithAvi => "avi",
    }
}
fn apply_render_codec_defaults(settings: &mut EffectiveChatOverlaySettings) {
    match settings.render_codec {
        ChatRenderCodec::RawRgbaPipe | ChatRenderCodec::SolidBgFast => {
            settings.compose_mode = ChatComposeMode::Direct;
            settings.save_alpha_overlay = false;
        }
        ChatRenderCodec::QtrleMovRle => {
            settings.compose_mode = ChatComposeMode::Intermediate;
            settings.alpha_output_format = AlphaOutputFormat::MovQtrle;
            settings.save_alpha_overlay = true;
        }
        ChatRenderCodec::Ffv1MkvAlpha => {
            settings.compose_mode = ChatComposeMode::Intermediate;
            settings.alpha_output_format = AlphaOutputFormat::Ffv1Mkv;
            settings.save_alpha_overlay = true;
        }
        ChatRenderCodec::Prores4444 => {
            settings.compose_mode = ChatComposeMode::Intermediate;
            settings.alpha_output_format = AlphaOutputFormat::Prores4444;
            settings.save_alpha_overlay = true;
        }
        ChatRenderCodec::Vp9WebmAlpha => {
            settings.compose_mode = ChatComposeMode::Intermediate;
            settings.alpha_output_format = AlphaOutputFormat::WebmVp9;
            settings.save_alpha_overlay = true;
        }
        ChatRenderCodec::LagarithAvi => {
            settings.compose_mode = ChatComposeMode::Intermediate;
            settings.alpha_output_format = AlphaOutputFormat::LagarithAvi;
            settings.save_alpha_overlay = true;
        }
    }
}

fn sanitize_file_stem(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "chat".to_string()
    } else {
        trimmed
    }
}

fn find_recorded_chat_for_video(job: &Job, input_video: &Path) -> Option<PathBuf> {
    if !is_kick_job(job) {
        return None;
    }
    let stem = input_video.file_stem().and_then(|s| s.to_str())?;
    let parent = input_video.parent().unwrap_or_else(|| Path::new("."));
    let output_stem = sanitize_file_stem(&job.spec.name);
    let output_dir = PathBuf::from(&job.spec.directory);
    [
        parent.join(format!("{stem}_kick_live_chat.json")),
        parent.join(format!("{stem}.kick_live_chat.json")),
        parent.join(format!("{output_stem}_kick_live_chat.json")),
        output_dir.join(format!("{output_stem}_kick_live_chat.json")),
        output_dir.join(format!("{output_stem}_chat.json")),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn read_non_empty_recorded_chat(path: &Path) -> Result<Option<Vec<model::ChatMessage>>> {
    let messages = read_chat_messages(path)?;
    if messages.is_empty() {
        Ok(None)
    } else {
        Ok(Some(messages))
    }
}

fn is_kick_job(job: &Job) -> bool {
    job.spec.url.to_ascii_lowercase().contains("kick.com")
        || job
            .spec
            .meta
            .platform
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("kick")
}

fn is_kick_live_job(job: &Job) -> bool {
    is_kick_job(job)
        && matches!(job.spec.mode, Mode::Live)
        && is_kick_live_channel_url(&job.spec.url)
}

pub fn emit_log(queue: &Arc<QueueManager>, id: &str, line: &str) {
    queue.emit_job_log(id, line);
}

pub fn parse_hms(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let parts: Vec<_> = value.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h = parts[0].parse::<f64>().ok()?;
    let m = parts[1].parse::<f64>().ok()?;
    let s = parts[2].parse::<f64>().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn normalize_chat_timestamps(
    messages: &mut Vec<model::ChatMessage>,
    trim_start: f64,
    duration: Option<f64>,
) {
    let trim_end = duration.map(|d| trim_start + d);
    messages.retain(|message| {
        message.timestamp >= trim_start
            && trim_end.map(|end| message.timestamp <= end).unwrap_or(true)
    });
    for message in messages.iter_mut() {
        message.timestamp = (message.timestamp - trim_start).max(0.0);
    }
    messages.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
}

fn infer_duration_from_messages(
    messages: &[model::ChatMessage],
    settings: &EffectiveChatOverlaySettings,
) -> Option<f64> {
    messages
        .last()
        .map(|message| message.timestamp + settings.message_lifetime_sec)
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

#[cfg(test)]
mod tests {
    use super::read_non_empty_recorded_chat;

    #[test]
    fn empty_recorded_chat_sidecar_is_not_valid() {
        let path = std::env::temp_dir().join(format!(
            "fetchr-empty-chat-{}.json",
            std::process::id()
        ));
        std::fs::write(&path, "[]").expect("write empty sidecar");
        let loaded = read_non_empty_recorded_chat(&path).expect("read empty sidecar");
        let _ = std::fs::remove_file(&path);
        assert!(loaded.is_none());
    }
}
