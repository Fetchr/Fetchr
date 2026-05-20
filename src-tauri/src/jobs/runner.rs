use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::binaries::{resolve_binary, FFMPEG, FFPROBE, NM3U8DL, YTDLP};
use crate::chat_overlay::kick_live::{is_kick_live_channel_url, start_kick_live_chat_recorder};
use crate::chat_overlay::{download_and_render_chat_only, parse_hms, render_and_compose_for_video};
use crate::commands::resolve::resolve_twitch_hls_url;
use crate::hls_proxy;
use crate::jobs::queue::QueueManager;
use crate::jobs::types::{
    DownloadKind, Job, JobKind, JobProgress, JobSpec, Mode, PerformanceSettings,
};

static RE_PERCENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?P<p>\d+(?:\.\d+)?)\s*%").expect("percent regex"));
static RE_SPEED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?P<s>\d+(?:\.\d+)?\s*[KMG]i?B/s)").expect("speed regex"));
static RE_ETA: Lazy<Regex> = Lazy::new(|| Regex::new(r"ETA\s+(?P<e>[\d:]+)").expect("eta regex"));
static RE_SIZE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"of\s+~?\s*(?P<sz>\d+(?:\.\d+)?\s*[KMGT]i?B)").expect("size regex"));
static RE_SEGMENT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:fragment|segment|frag)\D+(?P<seg>\d+\s*/\s*\d+)").expect("segment regex")
});
static RE_DIMENSIONS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?P<w>\d{3,5})x(?P<h>\d{3,5})").expect("dimension regex"));
const FETCHR_PROGRESS_PREFIX: &str = "FETCHR_PROGRESS|";

pub async fn run_job(queue: Arc<QueueManager>, job: Job, cancel: Arc<AtomicBool>) -> Result<()> {
    let bin_dir = job.spec.binaries_dir.as_deref().map(Path::new);

    if matches!(job.spec.job_kind, Some(JobKind::Chat)) {
        queue.set_progress_stage(&job.id, 0.0, 100.0, Some("Preparing chat task".to_string()));
        let output = download_and_render_chat_only(&queue, &job, cancel.clone(), bin_dir).await?;
        queue.set_output_path(&job.id, output.to_string_lossy().into_owned());
        queue.set_progress(
            &job.id,
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
                message: Some("Chat overlay ready".to_string()),
                ..JobProgress::default()
            },
        );
        return Ok(());
    }

    // Routing logic:
    // - Direct HLS (plain .m3u8 or twitch cloudfront VOD) -> N_m3u8DL-RE regardless
    //   of the live toggle, because yt-dlp's generic extractor often fails on
    //   cloudfront VOD playlists.
    // - Twitch live/VOD video                             -> Twitch HLS resolver + N_m3u8DL-RE
    //   so "best" can select source resolutions above 1080p when Twitch exposes them.
    // - Otherwise (youtube/kick/clips/audio)               -> yt-dlp.
    let is_direct_hls = is_hls_url(&job.spec.url);
    let is_twitch_vod = is_twitch_vod_url(&job.spec.url);
    let live_mode = matches!(job.spec.mode, Mode::Live);
    validate_download_spec(&queue, &job, is_direct_hls, is_twitch_vod, live_mode)?;
    let chat_enabled = job
        .spec
        .chat_overlay
        .as_ref()
        .and_then(|settings| settings.enabled)
        .unwrap_or(false);
    let postprocess_enabled =
        matches!(selected_download_kind(&job), DownloadKind::Video) && chat_enabled;

    let download_end = if postprocess_enabled {
        60.0
    } else if job.spec.split {
        95.0
    } else {
        100.0
    };

    if postprocess_enabled {
        queue.set_progress_stage(
            &job.id,
            0.0,
            download_end,
            Some("Downloading source video".to_string()),
        );
    } else {
        queue.set_progress_stage(
            &job.id,
            0.0,
            download_end,
            Some("Downloading source".to_string()),
        );
    }

    let download_started = std::time::Instant::now();
    let unmute_requested = job.spec.unmute_video
        && matches!(selected_download_kind(&job), DownloadKind::Video)
        && !live_mode;
    let selected_quality_is_hls = selected_quality_is_hls(&job.spec);
    let strict_twitch_1440 = twitch_video_quality_is_strict_1440(&job.spec);
    let twitch_video_vod =
        is_twitch_vod && matches!(selected_download_kind(&job), DownloadKind::Video);
    let use_nm3u8 = is_direct_hls
        || selected_quality_is_hls
        || live_mode
        || twitch_video_vod
        || (is_twitch_vod && unmute_requested);
    let kick_chat_recorder =
        if postprocess_enabled && live_mode && is_kick_live_channel_url(&job.spec.url) {
            let sidecar_path = kick_live_chat_sidecar_path(&job.spec);
            match start_kick_live_chat_recorder(
                queue.clone(),
                &job,
                bin_dir,
                sidecar_path,
                cancel.clone(),
            )
            .await
            {
                Ok(recorder) => Some(recorder),
                Err(err) => return Err(err.context("Kick live chat recorder could not start")),
            }
        } else {
            None
        };

    let download_result: Result<Vec<PathBuf>> = if use_nm3u8 {
        match run_nm3u8_fragments(&queue, &job, cancel.clone(), bin_dir, live_mode).await {
            Ok(paths) => Ok(paths),
            Err(err) if unmute_requested && is_twitch_vod && !is_direct_hls => {
                emit_log(
                    &queue,
                    &job.id,
                    &format!(
                        "!! Twitch VOD audio restore failed, falling back to ordinary yt-dlp download: {err:?}"
                    ),
                );
                run_ytdlp_fragments(&queue, &job, cancel.clone(), bin_dir)
                    .await
                    .with_context(|| format!("unmute failed ({err}); ordinary fallback failed"))
            }
            Err(err)
                if twitch_video_vod
                    && !selected_quality_is_hls
                    && !is_direct_hls
                    && !strict_twitch_1440 =>
            {
                emit_log(
                    &queue,
                    &job.id,
                    &format!(
                        "!! Twitch HLS source download failed, falling back to yt-dlp: {err:?}"
                    ),
                );
                run_ytdlp_fragments(&queue, &job, cancel.clone(), bin_dir)
                    .await
                    .with_context(|| format!("Twitch HLS failed ({err}); yt-dlp fallback failed"))
            }
            Err(err) => Err(err),
        }
    } else {
        run_ytdlp_fragments(&queue, &job, cancel.clone(), bin_dir).await
    };
    let kick_chat_stats = if let Some(recorder) = kick_chat_recorder {
        Some(recorder.stop_and_wait(&queue, &job.id).await)
    } else {
        None
    };
    let mut saved_paths = download_result?;
    if let Some(stats) = kick_chat_stats {
        let stats = stats?;
        if stats.parsed_messages == 0 {
            return Err(anyhow!(
                "Kick live chat recorder captured 0 messages. Check that the stream chat is active and that the task was started from the live channel URL."
            ));
        }
    }
    let download_elapsed = download_started.elapsed();
    let download_elapsed_ms = download_elapsed.as_millis().min(i64::MAX as u128) as i64;
    queue.set_download_elapsed(&job.id, download_elapsed_ms);
    emit_log(
        &queue,
        &job.id,
        &format!(
            "Source download time: {}",
            format_duration(download_elapsed.as_secs_f64())
        ),
    );

    if postprocess_enabled {
        let chat_end = if job.spec.split { 95.0 } else { 100.0 };
        queue.set_progress_stage(
            &job.id,
            60.0,
            chat_end,
            Some("Rendering chat overlay".to_string()),
        );
        let mut composed_paths = Vec::new();
        for path in saved_paths.iter() {
            let composed =
                render_and_compose_for_video(&queue, &job, path, cancel.clone(), bin_dir).await?;
            composed_paths.push(composed);
        }
        if !composed_paths.is_empty() {
            saved_paths = composed_paths;
        }
    }

    if job.spec.split && !cancel.load(Ordering::SeqCst) {
        queue.set_progress_stage(
            &job.id,
            95.0,
            100.0,
            Some("Splitting output file".to_string()),
        );
        for path in saved_paths.iter() {
            split_file_path(&queue, &job, path, bin_dir).await?;
        }
    }

    if let Some(first) = saved_paths.first() {
        queue.set_output_path(&job.id, first.to_string_lossy().into_owned());
    }

    Ok(())
}

/// Returns true if the URL is a direct HLS media playlist or a known Twitch
/// CDN VOD host that yt-dlp's Generic extractor can't always digest.
fn is_hls_url(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains(".m3u8") || u.contains("cloudfront.net")
}

fn is_twitch_vod_url(url: &str) -> bool {
    let u = url.to_lowercase();
    (u.contains("twitch.tv/videos/")
        || u.contains("twitch.tv/video/")
        || u.contains("twitch.tv/v/"))
        && !u.contains(".m3u8")
}

fn selected_download_kind(job: &Job) -> DownloadKind {
    job.spec.download_kind.unwrap_or(DownloadKind::Video)
}

fn kick_live_chat_sidecar_path(spec: &JobSpec) -> PathBuf {
    PathBuf::from(&spec.directory).join(format!(
        "{}_kick_live_chat.json",
        output_stem(&spec.name, None::<&ActiveFragment>)
    ))
}

fn performance_settings(spec: &JobSpec) -> PerformanceSettings {
    spec.performance.clone().unwrap_or_default().with_defaults()
}

fn validate_download_spec(
    queue: &Arc<QueueManager>,
    job: &Job,
    is_direct_hls: bool,
    is_twitch_vod: bool,
    live_mode: bool,
) -> Result<()> {
    let spec = &job.spec;
    if spec.url.trim().is_empty() {
        return Err(anyhow!("download URL is empty"));
    }
    if spec.name.trim().is_empty() {
        return Err(anyhow!("output file name is empty"));
    }
    let dir = PathBuf::from(spec.directory.trim());
    if spec.directory.trim().is_empty() {
        return Err(anyhow!("output directory is empty"));
    }
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("create output directory {}", dir.display()))?;
    if !dir.is_dir() {
        return Err(anyhow!("output path is not a directory: {}", dir.display()));
    }
    let probe_path = dir.join(format!(".fetchr-write-test-{}.tmp", job.id));
    std::fs::write(&probe_path, b"write-test")
        .with_context(|| format!("check write access to {}", dir.display()))?;
    let _ = std::fs::remove_file(&probe_path);

    let selected_quality_is_hls = selected_quality_is_hls(spec);
    emit_log(
        queue,
        &job.id,
        &format!(
            "Preflight OK: url={}, direct_hls={}, twitch_vod={}, selected_m3u8={}, live={}, directory={}",
            spec.url.trim(),
            is_direct_hls,
            is_twitch_vod,
            selected_quality_is_hls,
            live_mode,
            dir.display()
        ),
    );
    Ok(())
}

fn selected_quality_is_hls(spec: &JobSpec) -> bool {
    spec.quality
        .as_deref()
        .map(|q| q.to_lowercase().contains(".m3u8"))
        .unwrap_or(false)
}

fn twitch_video_quality_is_strict_1440(spec: &JobSpec) -> bool {
    is_twitch_url(&spec.url)
        && matches!(selected_download_kind_from_spec(spec), DownloadKind::Video)
        && requested_spec_height(spec).is_some_and(|height| height >= 1440)
}

fn selected_download_kind_from_spec(spec: &JobSpec) -> DownloadKind {
    spec.download_kind.unwrap_or(DownloadKind::Video)
}

#[derive(Debug, Clone)]
struct ActiveFragment {
    start: String,
    end: String,
    suffix: Option<String>,
}

fn normalized_fragments(spec: &JobSpec) -> Vec<ActiveFragment> {
    let fragments: Vec<_> = spec
        .fragments
        .iter()
        .filter_map(|fragment| {
            let start = fragment.start.trim();
            let end = fragment.end.trim();
            if start.is_empty() || end.is_empty() {
                return None;
            }
            Some((start.to_string(), end.to_string()))
        })
        .collect();

    if !fragments.is_empty() {
        return fragments
            .into_iter()
            .enumerate()
            .map(|(idx, (start, end))| ActiveFragment {
                start,
                end,
                suffix: Some(format!("_part{:02}", idx + 1)),
            })
            .collect();
    }

    match (spec.start.as_deref(), spec.end.as_deref()) {
        (Some(start), Some(end)) if !start.trim().is_empty() && !end.trim().is_empty() => {
            vec![ActiveFragment {
                start: start.trim().to_string(),
                end: end.trim().to_string(),
                suffix: None,
            }]
        }
        _ => Vec::new(),
    }
}

fn output_stem(base: &str, fragment: Option<&ActiveFragment>) -> String {
    match fragment.and_then(|f| f.suffix.as_deref()) {
        Some(suffix) => sanitize(&format!("{base}{suffix}")),
        None => sanitize(base),
    }
}

fn ytdlp_format_selector(spec: &JobSpec, download_kind: DownloadKind) -> String {
    match (download_kind, spec.quality.as_deref()) {
        (DownloadKind::Audio, Some(q)) if !q.is_empty() && q != "best" => q.to_string(),
        (DownloadKind::Audio, _) => "bestaudio/best".to_string(),
        (DownloadKind::Video, Some(q)) if !q.is_empty() && q != "best" => {
            if let Some(height) = requested_spec_height(spec) {
                return format!(
                    "bestvideo[height<={height}]+bestaudio/best[height<={height}]/bestvideo+bestaudio/best"
                );
            }
            if spec.quality_has_video == Some(true) && spec.quality_has_audio != Some(true) {
                format!("{q}+bestaudio/best")
            } else {
                q.to_string()
            }
        }
        (DownloadKind::Video, _) => "bestvideo+bestaudio/best".to_string(),
    }
}

async fn run_ytdlp_fragments(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
) -> Result<Vec<PathBuf>> {
    let ytdlp = resolve_binary(YTDLP, bin_dir)
        .ok_or_else(|| anyhow!("yt-dlp.exe not found - set binaries folder in Settings"))?;

    let spec = &job.spec;
    let performance = performance_settings(spec);
    let network_threads = performance.network_threads().to_string();
    let dir = PathBuf::from(&spec.directory);
    let download_kind = selected_download_kind(job);
    let fragments = normalized_fragments(spec);
    let work: Vec<Option<ActiveFragment>> = if fragments.is_empty() {
        vec![None]
    } else {
        fragments.into_iter().map(Some).collect()
    };
    let mut saved_paths = Vec::new();

    for fragment in work.iter() {
        if cancel.load(Ordering::SeqCst) {
            return Err(anyhow!("cancelled"));
        }

        let name = output_stem(&spec.name, fragment.as_ref());
        let expected_ext = match download_kind {
            DownloadKind::Video => "mp4",
            DownloadKind::Audio => "mp3",
        };
        let expected_path = dir.join(format!("{name}.{expected_ext}"));
        let out_template = dir.join(format!("{name}.%(ext)s"));

        if let Some(fragment) = fragment.as_ref() {
            emit_log(
                queue,
                &job.id,
                &format!(
                    "Downloading fragment {}-{} as {name}",
                    fragment.start, fragment.end
                ),
            );
        }

        let mut cmd = Command::new(&ytdlp);
        configure_ytdlp_env(&mut cmd);
        cmd.kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        cmd.args([
            "--newline",
            "-i",
            "--no-check-certificates",
            "--no-warnings",
            "--progress",
            "--progress-template",
            "download:FETCHR_PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s",
            "--concurrent-fragments",
            &network_threads,
            "--no-mtime",
            "--no-part",
            "--force-overwrites",
            "--add-header",
            "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "-o",
        ])
        .arg(&out_template);

        match download_kind {
            DownloadKind::Video => {
                cmd.args(["--merge-output-format", "mp4", "--remux-video", "mp4"]);
            }
            DownloadKind::Audio => {
                cmd.args([
                    "--extract-audio",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "0",
                ]);
            }
        }

        if let Some(ff) = resolve_binary(FFMPEG, bin_dir) {
            cmd.arg("--ffmpeg-location").arg(&ff);
        }

        if !spec.url.contains("cloudfront.net") {
            cmd.args(["--add-header", "Referer: https://www.twitch.tv/"]);
        }

        if let Some(fragment) = fragment.as_ref() {
            cmd.args([
                "--download-sections",
                &format!("*{}-{}", fragment.start, fragment.end),
            ]);
        }

        let format_selector = ytdlp_format_selector(spec, download_kind);
        cmd.args(["-f", &format_selector]);

        if let Some(px) = spec.proxy.for_ytdlp() {
            cmd.args(["--proxy", &px]);
        }

        cmd.arg(&spec.url);

        emit_log(queue, &job.id, &format!("$ {}", debug_cmd(&ytdlp, &cmd)));

        stream_process(queue, job, cancel.clone(), cmd).await?;

        let final_path = find_output_file(&dir, &name);
        if let Some(p) = final_path {
            emit_log(queue, &job.id, &format!("saved: {}", p.display()));
            saved_paths.push(p);
        } else {
            return Err(anyhow!(
                "yt-dlp finished but no output file found near {}",
                expected_path.display()
            ));
        }
    }

    if let Some(first) = saved_paths.first() {
        queue.set_output_path(&job.id, first.to_string_lossy().into_owned());
    }
    Ok(saved_paths)
}

#[allow(dead_code)]
async fn run_ytdlp(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
) -> Result<()> {
    let ytdlp = resolve_binary(YTDLP, bin_dir)
        .ok_or_else(|| anyhow!("yt-dlp.exe not found â€” set binaries folder in Settings"))?;

    let spec = &job.spec;
    let performance = performance_settings(spec);
    let network_threads = performance.network_threads().to_string();
    let name = sanitize(&spec.name);
    let dir = PathBuf::from(&spec.directory);
    // Always produce mp4 â€” we let yt-dlp handle remux.
    let download_kind = selected_download_kind(job);
    let expected_ext = match download_kind {
        DownloadKind::Video => "mp4",
        DownloadKind::Audio => "mp3",
    };
    let expected_path = dir.join(format!("{name}.{expected_ext}"));
    let out_template = dir.join(format!("{name}.%(ext)s"));

    let mut cmd = Command::new(&ytdlp);
    configure_ytdlp_env(&mut cmd);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.args([
        "--newline",
        "-i",
        "--no-check-certificates",
        "--no-warnings",
        "--progress",
        "--progress-template",
        "download:FETCHR_PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s",
        "--concurrent-fragments",
        &network_threads,
        "--no-mtime",
        "--no-part",
        "--force-overwrites",
        "--add-header",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "-o",
    ])
    .arg(&out_template);

    match download_kind {
        DownloadKind::Video => {
            cmd.args(["--merge-output-format", "mp4", "--remux-video", "mp4"]);
        }
        DownloadKind::Audio => {
            cmd.args([
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
            ]);
        }
    }

    // Point yt-dlp at our bundled ffmpeg explicitly so remux/merge won't silently
    // fail when ffmpeg isn't on PATH.
    if let Some(ff) = resolve_binary(FFMPEG, bin_dir) {
        cmd.arg("--ffmpeg-location").arg(&ff);
    }

    if !spec.url.contains("cloudfront.net") {
        cmd.args(["--add-header", "Referer: https://www.twitch.tv/"]);
    }

    if let (Some(a), Some(b)) = (spec.start.as_deref(), spec.end.as_deref()) {
        if !a.is_empty() && !b.is_empty() {
            cmd.args(["--download-sections", &format!("*{a}-{b}")]);
        }
    }

    if let Some(q) = spec.quality.as_deref() {
        if !q.is_empty() && q != "best" {
            let format_selector = match download_kind {
                DownloadKind::Audio => q.to_string(),
                DownloadKind::Video
                    if spec.quality_has_video == Some(true)
                        && spec.quality_has_audio == Some(false) =>
                {
                    format!("{q}+bestaudio/best")
                }
                DownloadKind::Video => q.to_string(),
            };
            cmd.args(["-f", &format_selector]);
        }
    } else if matches!(download_kind, DownloadKind::Audio) {
        cmd.args(["-f", "bestaudio/best"]);
    }

    if let Some(px) = spec.proxy.for_ytdlp() {
        cmd.args(["--proxy", &px]);
    }

    cmd.arg(&spec.url);

    emit_log(queue, &job.id, &format!("$ {}", debug_cmd(&ytdlp, &cmd)));

    stream_process(queue, job, cancel, cmd).await?;
    emit_unmute_stats(queue, job);

    // Verify output file actually exists. yt-dlp sometimes exits 0 without
    // producing anything (e.g. section filter yields empty, unsupported fmt).
    let final_path = find_output_file(&dir, &name);
    if let Some(p) = final_path {
        emit_log(queue, &job.id, &format!("âœ“ saved: {}", p.display()));
        queue.set_output_path(&job.id, p.to_string_lossy().into_owned());
        Ok(())
    } else {
        Err(anyhow!(
            "yt-dlp finished but no output file found near {}",
            expected_path.display()
        ))
    }
}

/// Find the saved file by sanitized name prefix in the directory.
fn find_output_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let exact = dir.join(format!("{name}.mp4"));
    if exact.is_file() {
        return Some(exact);
    }
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .find_map(|e| {
            let p = e.path();
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
            if p.is_file()
                && stem == name
                && matches!(
                    ext,
                    "mp4"
                        | "mkv"
                        | "ts"
                        | "webm"
                        | "m4a"
                        | "mov"
                        | "mp3"
                        | "aac"
                        | "opus"
                        | "ogg"
                        | "wav"
                        | "flac"
                )
            {
                Some(p)
            } else {
                None
            }
        })
}

fn find_output_file_since(dir: &Path, name: &str, since: SystemTime) -> Option<PathBuf> {
    find_output_file(dir, name).filter(|path| {
        let Ok(meta) = path.metadata() else {
            return false;
        };
        if meta.len() == 0 {
            return false;
        }
        meta.modified()
            .map(|modified| modified >= since)
            .unwrap_or(true)
    })
}

fn debug_cmd(bin: &Path, cmd: &Command) -> String {
    let std = cmd.as_std();
    let mut out = String::new();
    out.push_str(&quote_arg(bin.to_string_lossy().as_ref()));
    for a in std.get_args() {
        out.push(' ');
        out.push_str(&quote_arg(a.to_string_lossy().as_ref()));
    }
    out
}

fn debug_cmd_from_command(cmd: &Command) -> String {
    let std = cmd.as_std();
    let mut out = quote_arg(&std.get_program().to_string_lossy());
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

#[allow(dead_code)]
async fn run_nm3u8(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
    live: bool,
) -> Result<()> {
    let nm3u8 = resolve_binary(NM3U8DL, bin_dir)
        .ok_or_else(|| anyhow!("N_m3u8DL-RE.exe not found â€” set binaries folder in Settings"))?;

    let spec = &job.spec;
    let performance = performance_settings(spec);
    let network_threads = performance.network_threads().to_string();

    // Step 1: resolve direct m3u8 via yt-dlp -g (handles twitch.tv/user â†’ HLS).
    let direct_url = if spec.url.to_lowercase().contains(".m3u8") {
        spec.url.clone()
    } else {
        resolve_hls_url(queue, job, live, bin_dir)
            .await
            .context("failed to resolve direct HLS URL")?
    };
    let direct_url = maybe_proxy_unmute_hls(queue, spec, &job.id, direct_url, live);

    emit_log(
        queue,
        &job.id,
        &format!("Video HLS URL resolved: {direct_url}"),
    );
    if let Some(chat_source_url) = spec.chat_source_url.as_deref() {
        emit_log(
            queue,
            &job.id,
            &format!("Chat source URL: {chat_source_url}"),
        );
    }

    let mut cmd = Command::new(&nm3u8);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .arg(&direct_url)
        .args([
            "--thread-count",
            &network_threads,
            "--save-name",
            &sanitize(&spec.name),
            "--save-dir",
            &spec.directory,
            "-M",
            "format=mp4",
            "-H",
            "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ]);

    // Point N_m3u8DL-RE at our bundled ffmpeg for the final mux step.
    if let Some(ff) = resolve_binary(FFMPEG, bin_dir) {
        cmd.args(["--ffmpeg-binary-path"]).arg(&ff);
    }

    // Twitch CloudFront archive playlists (`.../index-dvr.m3u8`) omit
    // `#EXT-X-ENDLIST`, so N_m3u8DL-RE incorrectly flags them as LIVE and
    // keeps re-polling every 73s â€” the job never reaches 100%.
    // `--live-perform-as-vod` forces a single download pass + merge, which
    // is what we actually want for any CloudFront URL regardless of the
    // user's LIVE toggle.
    let is_cloudfront_vod = direct_url.contains("cloudfront.net");
    if is_cloudfront_vod {
        cmd.args(["--live-perform-as-vod", "true"]);
        cmd.arg("--allow-hls-multi-ext-map");
        if live {
            emit_log(
                queue,
                &job.id,
                "LIVE toggle: CloudFront URL is a VOD archive â€” forcing one-pass VOD mode.",
            );
        }
    } else if live {
        cmd.args(["--live-real-time-merge", "true"]);
    }

    cmd.args(["-H", "Referer: https://www.twitch.tv/"]);

    if let Some(px) = spec.proxy.for_n_m3u8dl() {
        cmd.args(["--custom-proxy", &px]);
    }

    if let (Some(a), Some(b)) = (spec.start.as_deref(), spec.end.as_deref()) {
        if !a.is_empty() && !b.is_empty() {
            cmd.args(["--custom-range", &format!("{a}-{b}")]);
        }
    }

    emit_log(queue, &job.id, &format!("$ {}", debug_cmd(&nm3u8, &cmd)));

    stream_process(queue, job, cancel, cmd).await?;

    let final_path = find_output_file(&PathBuf::from(&spec.directory), &sanitize(&spec.name));
    if let Some(p) = final_path {
        emit_log(queue, &job.id, &format!("âœ“ saved: {}", p.display()));
        queue.set_output_path(&job.id, p.to_string_lossy().into_owned());
    }
    Ok(())
}

async fn run_nm3u8_fragments(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
    live: bool,
) -> Result<Vec<PathBuf>> {
    let nm3u8 = resolve_binary(NM3U8DL, bin_dir)
        .ok_or_else(|| anyhow!("N_m3u8DL-RE.exe not found - set binaries folder in Settings"))?;

    let spec = &job.spec;
    let performance = performance_settings(spec);
    let network_threads = performance.network_threads().to_string();
    let direct_url = if spec.url.to_lowercase().contains(".m3u8") {
        spec.url.clone()
    } else {
        resolve_hls_url(queue, job, live, bin_dir)
            .await
            .context("failed to resolve direct HLS URL")?
    };
    let original_hls_url = direct_url.clone();
    let direct_url = maybe_proxy_unmute_hls(queue, spec, &job.id, direct_url, live);
    let materialized_playlist =
        match materialize_twitch_vod_playlist(queue, &job.id, &direct_url).await {
            Ok(playlist) => playlist,
            Err(err) => {
                let strict_twitch_1440 = twitch_video_quality_is_strict_1440(spec);
                emit_log(
                    queue,
                    &job.id,
                    &format!(
                        "!! Video HLS materialization failed{}: {err:#}",
                        if strict_twitch_1440 {
                            ""
                        } else {
                            ", trying original HLS URL"
                        }
                    ),
                );
                if strict_twitch_1440 {
                    return Err(
                        err.context("Selected Twitch 1440p HLS URL is not publicly downloadable")
                    );
                }
                None
            }
        };
    let download_url = materialized_playlist
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| direct_url.clone());
    let is_twitch_vod_archive = original_hls_url.contains("cloudfront.net")
        || original_hls_url.contains("ttvnw.net")
        || is_twitch_vod_url(&spec.url);

    emit_log(
        queue,
        &job.id,
        &format!("Video HLS URL resolved: {direct_url}"),
    );
    if let Some(chat_source_url) = spec.chat_source_url.as_deref() {
        emit_log(
            queue,
            &job.id,
            &format!("Chat source URL: {chat_source_url}"),
        );
    }

    let fragments = normalized_fragments(spec);
    let work: Vec<Option<ActiveFragment>> = if fragments.is_empty() {
        vec![None]
    } else {
        fragments.into_iter().map(Some).collect()
    };
    let mut saved_paths = Vec::new();

    for fragment in work.iter() {
        if cancel.load(Ordering::SeqCst) {
            return Err(anyhow!("cancelled"));
        }

        let save_name = output_stem(&spec.name, fragment.as_ref());
        if let Some(fragment) = fragment.as_ref() {
            emit_log(
                queue,
                &job.id,
                &format!(
                    "Downloading fragment {}-{} as {save_name}",
                    fragment.start, fragment.end
                ),
            );
        }

        let mut cmd = Command::new(&nm3u8);
        cmd.kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .arg(&download_url)
            .args([
                "--thread-count",
                &network_threads,
                "--save-name",
                &save_name,
                "--save-dir",
                &spec.directory,
                "-M",
                "format=mp4",
                "-H",
                "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ]);

        if let Some(ff) = resolve_binary(FFMPEG, bin_dir) {
            cmd.args(["--ffmpeg-binary-path"]).arg(&ff);
        }

        if is_twitch_vod_archive {
            cmd.args(["--live-perform-as-vod", "true"]);
            cmd.arg("--allow-hls-multi-ext-map");
            if live {
                emit_log(
                    queue,
                    &job.id,
                    "LIVE toggle: Twitch VOD archive - forcing one-pass VOD mode.",
                );
            }
        } else if live {
            cmd.args(["--live-real-time-merge", "true"]);
        }

        cmd.args(["-H", "Referer: https://www.twitch.tv/"]);

        if let Some(px) = spec.proxy.for_n_m3u8dl() {
            cmd.args(["--custom-proxy", &px]);
        }

        if let Some(fragment) = fragment.as_ref() {
            cmd.args([
                "--custom-range",
                &format!("{}-{}", fragment.start, fragment.end),
            ]);
        }

        emit_log(queue, &job.id, &format!("$ {}", debug_cmd(&nm3u8, &cmd)));

        let started_at = SystemTime::now();
        stream_process(queue, job, cancel.clone(), cmd).await?;
        emit_unmute_stats(queue, job);

        if let Some(p) =
            find_output_file_since(&PathBuf::from(&spec.directory), &save_name, started_at)
        {
            emit_log(queue, &job.id, &format!("saved: {}", p.display()));
            saved_paths.push(p);
        } else if is_twitch_vod_archive {
            if let Some(fragment) = fragment.as_ref() {
                emit_log(
                    queue,
                    &job.id,
                    "!! N_m3u8DL-RE did not create an output file for this Twitch HLS range; trying ffmpeg fallback.",
                );
                let fallback_path = run_ffmpeg_hls_fragment_fallback(
                    queue,
                    job,
                    cancel.clone(),
                    bin_dir,
                    &download_url,
                    &save_name,
                    fragment,
                    started_at,
                )
                .await?;
                emit_log(
                    queue,
                    &job.id,
                    &format!("saved: {}", fallback_path.display()),
                );
                saved_paths.push(fallback_path);
            } else {
                let msg = format!(
                    "N_m3u8DL-RE finished but did not create a new non-empty output file for {save_name}"
                );
                emit_log(queue, &job.id, &format!("!! {msg}"));
                return Err(anyhow!(msg));
            }
        } else {
            let msg = format!(
                "N_m3u8DL-RE finished but did not create a new non-empty output file for {save_name}"
            );
            emit_log(queue, &job.id, &format!("!! {msg}"));
            return Err(anyhow!(msg));
        }
    }

    if let Some(first) = saved_paths.first() {
        queue.set_output_path(&job.id, first.to_string_lossy().into_owned());
    } else {
        return Err(anyhow!(
            "N_m3u8DL-RE finished without downloaded fragments or output files"
        ));
    }

    Ok(saved_paths)
}

async fn run_ffmpeg_hls_fragment_fallback(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    bin_dir: Option<&Path>,
    playlist_url: &str,
    save_name: &str,
    fragment: &ActiveFragment,
    started_at: SystemTime,
) -> Result<PathBuf> {
    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found - set binaries folder in Settings"))?;
    let start = parse_hms(Some(&fragment.start))
        .ok_or_else(|| anyhow!("invalid fragment start time: {}", fragment.start))?;
    let end = parse_hms(Some(&fragment.end))
        .ok_or_else(|| anyhow!("invalid fragment end time: {}", fragment.end))?;
    let duration = end - start;
    if duration <= 0.0 {
        return Err(anyhow!(
            "selected fragment has empty duration: {}-{}",
            fragment.start,
            fragment.end
        ));
    }

    let output = PathBuf::from(&job.spec.directory).join(format!("{save_name}.mp4"));
    let mut cmd = Command::new(&ffmpeg);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .args(["-y", "-hide_banner", "-loglevel", "info"])
        .args([
            "-protocol_whitelist",
            "file,http,https,tcp,tls,crypto",
            "-ss",
            &format!("{start:.3}"),
            "-i",
            playlist_url,
            "-t",
            &format!("{duration:.3}"),
            "-map",
            "0:v?",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
        ])
        .arg(&output);

    emit_log(
        queue,
        &job.id,
        &format!(
            "ffmpeg fallback range: {}-{} ({})",
            fragment.start,
            fragment.end,
            format_duration(duration)
        ),
    );
    emit_log(queue, &job.id, &format!("$ {}", debug_cmd(&ffmpeg, &cmd)));

    stream_process(queue, job, cancel, cmd).await?;

    if output.is_file()
        && output
            .metadata()
            .map(|meta| meta.len() > 0)
            .unwrap_or(false)
        && output
            .metadata()
            .and_then(|meta| meta.modified())
            .map(|modified| modified >= started_at)
            .unwrap_or(true)
    {
        return Ok(output);
    }

    Err(anyhow!(
        "ffmpeg fallback finished but did not create a new non-empty output file for {save_name}"
    ))
}

fn requested_quality_height(quality: &str) -> Option<u32> {
    let lower = quality.trim().to_lowercase();
    if lower.contains(".m3u8") {
        return None;
    }
    static HEIGHT_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)(?:height\s*<=\s*|height\s*=\s*|^|[^0-9])(?P<h>[1-9][0-9]{2,3})\s*p?")
            .expect("height regex")
    });
    HEIGHT_RE
        .captures(&lower)
        .and_then(|captures| captures.name("h"))
        .and_then(|height| height.as_str().parse::<u32>().ok())
}

fn requested_spec_height(spec: &JobSpec) -> Option<u32> {
    spec.quality_height
        .or_else(|| spec.quality.as_deref().and_then(requested_quality_height))
}

fn explicit_quality_label_for_height(spec: &JobSpec, height: u32) -> Option<String> {
    match spec.quality.as_deref() {
        Some(quality) if !quality.trim().is_empty() && quality != "best" => {
            if quality.to_lowercase().contains(".m3u8") {
                Some(format!("{height}p"))
            } else {
                Some(quality.to_string())
            }
        }
        _ => Some(format!("{height}p")),
    }
}

async fn materialize_twitch_vod_playlist(
    queue: &Arc<QueueManager>,
    job_id: &str,
    direct_url: &str,
) -> Result<Option<PathBuf>> {
    if !is_twitch_cdn_url(direct_url) {
        return Ok(None);
    }

    let text = fetch_twitch_hls_playlist_text(direct_url).await?;

    let base = url::Url::parse(direct_url).context("parse Twitch VOD media playlist URL")?;
    if text.contains("#EXT-X-ENDLIST") && base.query().is_none() {
        return Ok(None);
    }

    let mut out = String::with_capacity(text.len() + 256);
    for line in text.lines().map(str::trim) {
        if line.is_empty() {
            out.push('\n');
            continue;
        }
        if line.starts_with("#EXT-X-PLAYLIST-TYPE:EVENT") {
            out.push_str("#EXT-X-PLAYLIST-TYPE:VOD");
        } else if line.starts_with("#EXT-X-MAP:") || line.starts_with("#EXT-X-KEY:") {
            out.push_str(&absolutize_hls_uri_attrs(line, &base));
        } else if line.starts_with('#') {
            out.push_str(line);
        } else {
            out.push_str(&absolutize_hls_uri(line, &base));
        }
        out.push('\n');
    }
    out.push_str("#EXT-X-ENDLIST\n");

    let path = std::env::temp_dir().join(format!("fetchr-twitch-vod-{job_id}.m3u8"));
    let mut file = std::fs::File::create(&path)
        .with_context(|| format!("create materialized playlist {}", path.display()))?;
    file.write_all(out.as_bytes())
        .with_context(|| format!("write materialized playlist {}", path.display()))?;

    emit_log(
        queue,
        job_id,
        &format!(
            "Twitch VOD playlist materialized as finite local m3u8: {}",
            path.display()
        ),
    );

    Ok(Some(path))
}

async fn fetch_twitch_hls_playlist_text(direct_url: &str) -> Result<String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .context("configure Twitch playlist client")?
        .get(direct_url)
        .header("Referer", "https://www.twitch.tv/")
        .header("Origin", "https://www.twitch.tv")
        .header(
            "Accept",
            "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
        )
        .send()
        .await
        .context("fetch Twitch VOD media playlist")?
        .error_for_status()
        .context("Twitch VOD media playlist returned an error")?
        .text()
        .await
        .context("read Twitch VOD media playlist")
}

fn absolutize_hls_uri_attrs(line: &str, base: &url::Url) -> String {
    static URI_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"URI="(?P<uri>[^"]+)""#).expect("HLS URI regex"));
    URI_RE
        .replace_all(line, |captures: &regex::Captures| {
            let uri = captures.name("uri").map(|m| m.as_str()).unwrap_or_default();
            let absolute = absolutize_hls_uri(uri, base);
            format!("URI=\"{absolute}\"")
        })
        .into_owned()
}

fn absolutize_hls_uri(uri: &str, base: &url::Url) -> String {
    let Ok(mut absolute) = base.join(uri) else {
        return uri.to_string();
    };

    // Twitch VOD CDN playlists can be signed on the media playlist URL.
    // Segment/MAP/KEY URIs sometimes are relative, and sometimes are absolute
    // same-CDN URLs without their own query string. Both must inherit the
    // media playlist signature; otherwise N_m3u8DL-RE loads unsigned
    // CloudFront URLs and gets 403 Forbidden.
    if absolute.query().is_none() && should_inherit_twitch_query(uri, base, &absolute) {
        if let Some(query) = base.query() {
            absolute.set_query(Some(query));
        }
    }

    absolute.to_string()
}

fn should_inherit_twitch_query(uri: &str, base: &url::Url, absolute: &url::Url) -> bool {
    uri_is_relative(uri)
        || (is_twitch_cdn_url(absolute.as_str())
            && base.host_str().is_some()
            && absolute.host_str() == base.host_str())
}

fn uri_is_relative(uri: &str) -> bool {
    let trimmed = uri.trim();
    !(trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("//"))
}

fn is_twitch_cdn_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("cloudfront.net") || lower.contains("ttvnw.net")
}

fn twitch_hls_url_matches_requested_height(url: &str, height: u32) -> bool {
    let lower = url.to_lowercase();
    if height < 1440 {
        return true;
    }
    if lower.contains("chunked")
        || lower.contains("source")
        || lower.contains(&format!("{height}p"))
        || lower.contains(&format!("/{height}/"))
    {
        return true;
    }
    !(lower.contains("1080p")
        || lower.contains("720p")
        || lower.contains("480p")
        || lower.contains("360p")
        || lower.contains("160p"))
}

async fn accept_verified_twitch_hls(
    queue: &Arc<QueueManager>,
    job: &Job,
    bin_dir: Option<&Path>,
    url: String,
    requested_height: u32,
    label: &str,
) -> Result<Option<String>> {
    if is_twitch_cdn_url(&url) {
        match fetch_twitch_hls_playlist_text(&url).await {
            Ok(_) => {}
            Err(err) => {
                emit_log(
                    queue,
                    &job.id,
                    &format!("{label} media playlist is not downloadable: {err:#}"),
                );
                return Ok(None);
            }
        }
    }

    match verify_hls_video_dimensions(queue, job, bin_dir, &url).await {
        Ok((width, height)) => {
            emit_log(
                queue,
                &job.id,
                &format!("Verified video height: {width}x{height}"),
            );
            if height >= requested_height {
                emit_log(
                    queue,
                    &job.id,
                    &format!("Selected video source: {label} ({width}x{height})"),
                );
                Ok(Some(url))
            } else {
                emit_log(
                    queue,
                    &job.id,
                    &format!(
                        "{label} returned {width}x{height}; rejected because {requested_height}p was selected."
                    ),
                );
                Ok(None)
            }
        }
        Err(err) => {
            emit_log(
                queue,
                &job.id,
                &format!("{label} playlist could not be verified: {err:#}"),
            );
            Ok(None)
        }
    }
}

async fn verify_hls_video_dimensions(
    queue: &Arc<QueueManager>,
    job: &Job,
    bin_dir: Option<&Path>,
    url: &str,
) -> Result<(u32, u32)> {
    let ffprobe = resolve_binary(FFPROBE, bin_dir)
        .ok_or_else(|| anyhow!("ffprobe.exe not found; cannot verify Twitch 1440p"))?;
    let mut cmd = Command::new(&ffprobe);
    cmd.kill_on_drop(true)
        .arg("-v")
        .arg("error")
        .args([
            "-headers",
            "Referer: https://www.twitch.tv/\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n",
        ])
        .args(["-select_streams", "v:0"])
        .args(["-show_entries", "stream=width,height"])
        .args(["-of", "csv=s=x:p=0"])
        .arg(url);

    let command_line = debug_cmd_from_command(&cmd);
    queue.log_command_started(
        &job.id,
        command_line.clone(),
        Some(json!({
            "action": "verify_hls_video_dimensions",
            "url": redact_signed_url(url),
        })),
    );
    let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .context("ffprobe timed out while verifying HLS")?
        .context("spawn ffprobe")?;
    queue.log_command_finished(&job.id, command_line, output.status.code());

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stdout.lines() {
        queue.log_stdout(&job.id, line);
    }
    for line in stderr.lines() {
        queue.log_stderr(&job.id, line);
    }

    if !output.status.success() {
        return Err(anyhow!(
            "ffprobe failed while verifying HLS: {}",
            stderr.trim()
        ));
    }

    parse_dimensions(&stdout)
        .ok_or_else(|| anyhow!("ffprobe did not return video dimensions: {}", stdout.trim()))
}

fn parse_dimensions(output: &str) -> Option<(u32, u32)> {
    output.lines().find_map(|line| {
        let captures = RE_DIMENSIONS.captures(line.trim())?;
        let width = captures.name("w")?.as_str().parse::<u32>().ok()?;
        let height = captures.name("h")?.as_str().parse::<u32>().ok()?;
        Some((width, height))
    })
}

fn redact_signed_url(url: &str) -> String {
    match url.find('?') {
        Some(index) => format!("{}?<redacted>", &url[..index]),
        None => url.to_string(),
    }
}

async fn resolve_hls_url(
    queue: &Arc<QueueManager>,
    job: &Job,
    live: bool,
    bin_dir: Option<&Path>,
) -> Result<String> {
    let spec = &job.spec;
    let requested_height = requested_spec_height(spec);
    if let Some(q) = spec
        .quality
        .as_deref()
        .filter(|q| !q.is_empty() && *q != "best")
    {
        if q.to_lowercase().contains(".m3u8") {
            if is_twitch_url(&spec.url) && requested_height.is_some_and(|height| height >= 1440) {
                emit_log(
                    queue,
                    &job.id,
                    "Ignoring UI-provided Twitch m3u8 quality URL; resolving through Twitch Usher like TwitchDownloader.",
                );
            } else {
                return Ok(q.to_string());
            }
        }
    }

    if is_twitch_url(&spec.url) {
        if requested_height.is_some_and(|height| height >= 1440) {
            let height = requested_height.unwrap_or(1440);
            let resolver_quality = explicit_quality_label_for_height(spec, height);
            emit_log(queue, &job.id, &format!("Trying Twitch usher {height}p"));
            match resolve_twitch_hls_url(&spec.url, resolver_quality.as_deref(), live, &spec.proxy)
                .await
            {
                Ok(Some(url)) => {
                    if let Some(url) =
                        accept_verified_twitch_hls(queue, job, bin_dir, url, height, "Twitch usher")
                            .await?
                    {
                        return Ok(url);
                    }
                }
                Ok(None) => emit_log(
                    queue,
                    &job.id,
                    &format!("Twitch usher did not return a {height}p playlist."),
                ),
                Err(err) => emit_log(
                    queue,
                    &job.id,
                    &format!("Twitch usher {height}p resolver failed: {err}"),
                ),
            }

            return Err(anyhow!(
                "{height}p not found in Twitch Usher master playlist or not publicly accessible."
            ));
        }

        match resolve_twitch_hls_url(
            &spec.url,
            spec.quality.as_deref(),
            live || !is_twitch_vod_url(&spec.url),
            &spec.proxy,
        )
        .await
        {
            Ok(Some(url)) => {
                if requested_height.is_some_and(|height| {
                    height >= 1440 && !twitch_hls_url_matches_requested_height(&url, height)
                }) {
                    emit_log(
                        queue,
                        &job.id,
                        "!! Twitch anonymous token returned a lower HLS variant for requested 1440p.",
                    );
                } else {
                    return Ok(url);
                }
            }
            Ok(None) => {}
            Err(err) => emit_log(
                queue,
                &job.id,
                &format!("!! Twitch HLS resolver fallback to yt-dlp -g: {err}"),
            ),
        }
    }

    let ytdlp = resolve_binary(YTDLP, bin_dir).ok_or_else(|| anyhow!("yt-dlp.exe not found"))?;

    let mut cmd = Command::new(&ytdlp);
    configure_ytdlp_env(&mut cmd);
    cmd.arg("-g")
        .arg("--no-check-certificates")
        .arg("--no-warnings")
        .arg("-f");
    let format_selector = spec
        .quality
        .as_deref()
        .filter(|q| !q.is_empty() && *q != "best")
        .map(|q| {
            requested_spec_height(spec)
                .map(|height| {
                    format!("best[height<={height}][protocol^=m3u8]/best[height<={height}]/best")
                })
                .unwrap_or_else(|| q.to_string())
        })
        .unwrap_or_else(|| "best[protocol^=m3u8]/best".to_string());
    cmd.arg(format_selector).arg(&spec.url);

    if let Some(px) = spec.proxy.for_ytdlp() {
        cmd.args(["--proxy", &px]);
    }

    let command_line = debug_cmd(&ytdlp, &cmd);
    emit_log(
        queue,
        &job.id,
        &format!("Resolving direct HLS URL with: {command_line}"),
    );
    queue.log_command_started(
        &job.id,
        command_line.clone(),
        Some(json!({
            "action": "resolve_hls_url",
            "url": spec.url.clone(),
            "quality": spec.quality.clone(),
            "live": live,
        })),
    );
    let output = cmd.output().await.context("spawning yt-dlp -g")?;
    queue.log_command_finished(&job.id, command_line, output.status.code());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stdout.lines() {
        queue.log_stdout(&job.id, line);
    }
    for line in stderr.lines() {
        queue.log_stderr(&job.id, line);
    }
    if !output.status.success() {
        return Err(anyhow!("yt-dlp -g failed: {}", stderr));
    }
    let resolved = stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("yt-dlp -g returned empty output"))?;

    if is_twitch_url(&spec.url)
        && requested_height.is_some_and(|height| {
            height >= 1440 && !twitch_hls_url_matches_requested_height(&resolved, height)
        })
    {
        return Err(anyhow!(
            "Twitch returned 1080p for requested 1440p. Для 1440p Twitch требует авторизованную браузерную сессию: закрой Edge/Chrome перед скачиванием или войди в Twitch в Firefox, затем повтори."
        ));
    }

    Ok(resolved)
}

fn is_twitch_url(url: &str) -> bool {
    url.to_lowercase().contains("twitch.tv")
}

fn maybe_proxy_unmute_hls(
    queue: &Arc<QueueManager>,
    spec: &JobSpec,
    job_id: &str,
    direct_url: String,
    live: bool,
) -> String {
    if spec.unmute_video && !live && is_twitch_unmute_candidate(&spec.url, &direct_url) {
        hls_proxy::reset_unmute_stats(job_id);
        let proxied = match hls_proxy::proxied_hls_url_internal(
            direct_url.clone(),
            Some("https://www.twitch.tv/".to_string()),
            true,
            Some(job_id),
        ) {
            Ok(url) => url,
            Err(err) => {
                emit_log(
                    queue,
                    job_id,
                    &format!("!! Unmute Video unavailable, using ordinary HLS URL instead: {err}"),
                );
                return direct_url;
            }
        };
        emit_log(
            queue,
            job_id,
            &format!("Twitch VOD audio restore: routing HLS through local muted/unmuted segment proxy: {proxied}"),
        );
        return proxied;
    }
    if spec.unmute_video && live {
        emit_log(
            queue,
            job_id,
            "!! Twitch VOD audio restore is disabled for live streams.",
        );
    } else if spec.unmute_video {
        emit_log(
            queue,
            job_id,
            "!! Twitch VOD audio restore is unavailable for this URL; using ordinary download.",
        );
    }
    direct_url
}

fn is_twitch_unmute_candidate(input_url: &str, direct_url: &str) -> bool {
    is_twitch_vod_url(input_url)
        || direct_url.contains("cloudfront.net")
        || direct_url.contains("ttvnw.net")
        || direct_url.contains("twitch.tv")
}

fn emit_unmute_stats(queue: &Arc<QueueManager>, job: &Job) {
    if !job.spec.unmute_video {
        return;
    }
    let stats = hls_proxy::take_unmute_stats(&job.id);
    emit_log(
        queue,
        &job.id,
        &format!(
            "Twitch VOD audio restore: checked {} segments, restored {}, fell back to muted {}. Restore manifests found: {}. Segment -unmuted hits: {}.",
            stats.checked_segments,
            stats.restored_segments,
            stats.muted_fallback_segments,
            stats.restore_manifests_found,
            stats.unmuted_segments
        ),
    );
    if stats.checked_segments == 0 {
        emit_log(
            queue,
            &job.id,
            "Twitch VOD audio restore: Ð² Ð²Ñ‹Ð±Ñ€Ð°Ð½Ð½Ð¾Ð¼ Ð´Ð¸Ð°Ð¿Ð°Ð·Ð¾Ð½Ðµ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾ AP-muted ÑÐµÐ³Ð¼ÐµÐ½Ñ‚Ð¾Ð² Ð´Ð»Ñ Ð²Ð¾ÑÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ.",
        );
    } else if stats.restored_segments == 0 {
        emit_log(
            queue,
            &job.id,
            "!! Ð”Ð»Ñ Ð²Ñ‹Ð±Ñ€Ð°Ð½Ð½Ð¾Ð³Ð¾ Ð´Ð¸Ð°Ð¿Ð°Ð·Ð¾Ð½Ð° Twitch Ð½Ðµ Ð¾Ñ‚Ð´Ð°Ñ‘Ñ‚ unmuted/original ÑÐµÐ³Ð¼ÐµÐ½Ñ‚Ñ‹.",
        );
    }
    if let Some(url) = stats.restore_manifest_url {
        emit_log(
            queue,
            &job.id,
            &format!("Twitch VOD audio restore manifest: {url}"),
        );
    }
    if !stats.failed_candidates.is_empty() {
        emit_log(
            queue,
            &job.id,
            &format!(
                "Twitch VOD audio restore failed candidate examples: {}",
                stats.failed_candidates.join(" | ")
            ),
        );
    }
}

#[allow(dead_code)]
async fn split_file(queue: &Arc<QueueManager>, job: &Job, bin_dir: Option<&Path>) -> Result<()> {
    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found â€” set binaries folder in Settings"))?;

    let name = sanitize(&job.spec.name);
    let input = PathBuf::from(&job.spec.directory).join(format!("{name}.mp4"));
    if !input.is_file() {
        return Ok(()); // nothing to split
    }
    let pattern = PathBuf::from(&job.spec.directory).join(format!("{name}_part%03d.mp4"));
    let split_seconds = job.spec.split_interval_minutes.unwrap_or(1).clamp(1, 120) * 60;

    emit_log(
        queue,
        &job.id,
        &format!("Splitting into {split_seconds}-second parts..."),
    );

    let status = Command::new(&ffmpeg)
        .args(["-y", "-hide_banner", "-i"])
        .arg(&input)
        .args([
            "-f",
            "segment",
            "-segment_time",
            &split_seconds.to_string(),
            "-c",
            "copy",
            "-reset_timestamps",
            "1",
        ])
        .arg(&pattern)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;

    if status.success() {
        let _ = std::fs::remove_file(&input);
    }
    Ok(())
}

async fn split_file_path(
    queue: &Arc<QueueManager>,
    job: &Job,
    input: &Path,
    bin_dir: Option<&Path>,
) -> Result<()> {
    let ffmpeg = resolve_binary(FFMPEG, bin_dir)
        .ok_or_else(|| anyhow!("ffmpeg.exe not found - set binaries folder in Settings"))?;

    if !input.is_file() {
        return Ok(());
    }
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let pattern = input
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{stem}_part%03d.mp4"));
    let split_seconds = job.spec.split_interval_minutes.unwrap_or(1).clamp(1, 120) * 60;

    emit_log(
        queue,
        &job.id,
        &format!(
            "Splitting {} into {split_seconds}-second parts...",
            input.display()
        ),
    );

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-y", "-hide_banner", "-i"])
        .arg(input)
        .args([
            "-f",
            "segment",
            "-segment_time",
            &split_seconds.to_string(),
            "-c",
            "copy",
            "-reset_timestamps",
            "1",
        ])
        .arg(&pattern)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    stream_process(queue, job, Arc::new(AtomicBool::new(false)), cmd).await?;
    let _ = std::fs::remove_file(input);
    Ok(())
}

async fn stream_process(
    queue: &Arc<QueueManager>,
    job: &Job,
    cancel: Arc<AtomicBool>,
    mut cmd: Command,
) -> Result<()> {
    // Hide console window on Windows.
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let command_line = debug_cmd_from_command(&cmd);
    queue.log_command_started(&job.id, command_line.clone(), None);

    let mut child: Child = cmd.spawn().context("spawn process")?;
    let stdout = child.stdout.take().context("stdout handle")?;
    let stderr = child.stderr.take().context("stderr handle")?;

    let id = job.id.clone();
    let q1 = queue.clone();
    let q2 = queue.clone();

    let stdout_task = tokio::spawn({
        let id = id.clone();
        async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                q1.log_stdout(&id, &line);
                emit_log(&q1, &id, &line);
                if let Some(p) = parse_progress(&line) {
                    q1.set_progress(&id, p);
                }
            }
        }
    });

    let stderr_task = tokio::spawn({
        let id = id.clone();
        async move {
            let mut captured = String::new();
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if !captured.is_empty() {
                    captured.push('\n');
                }
                captured.push_str(&line);
                q2.log_stderr(&id, &line);
                if is_process_error_line(&line) {
                    emit_log(&q2, &id, &format!("!! {line}"));
                } else {
                    emit_log(&q2, &id, &line);
                }
                if let Some(p) = parse_progress(&line) {
                    q2.set_progress(&id, p);
                }
            }
            captured
        }
    });

    // Cancel watcher
    let cancel_flag = cancel.clone();
    let pid = child.id();
    let watcher = tokio::spawn(async move {
        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                #[cfg(windows)]
                if let Some(pid) = pid {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .creation_flags(0x0800_0000)
                        .status();
                }
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    });

    let status = child.wait().await?;
    queue.log_command_finished(&job.id, command_line, status.code());
    watcher.abort();
    let _ = stdout_task.await;
    let stderr = stderr_task.await.unwrap_or_default();

    if cancel.load(Ordering::SeqCst) {
        return Err(anyhow!("cancelled"));
    }
    if !status.success() {
        if let Some(message) = friendly_process_error(job, &stderr) {
            emit_log(queue, &job.id, &format!("!! {message}"));
            return Err(anyhow!(message));
        }
        return Err(anyhow!("process exited with {}", status));
    }
    Ok(())
}

fn friendly_process_error(job: &Job, stderr: &str) -> Option<String> {
    let lower = stderr.to_lowercase();
    if is_twitch_vod_url(&job.spec.url)
        && lower.contains("nonetype")
        && lower.contains("not subscriptable")
    {
        return Some(
            "yt-dlp не смог получить Twitch access token; обновите yt-dlp или проверьте доступность VOD в браузере."
                .to_string(),
        );
    }
    None
}

fn is_process_error_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    if is_benign_process_stderr_line(&lower) {
        return false;
    }
    lower.contains("error")
        || lower.contains("failed")
        || lower.contains("exception")
        || lower.contains("invalid data")
        || lower.contains("403")
        || lower.contains("forbidden")
        || lower.contains("cannot")
        || lower.contains("unable")
}

fn is_benign_process_stderr_line(lower: &str) -> bool {
    lower.starts_with("ffmpeg version")
        || lower.starts_with("libav")
        || lower.starts_with("configuration:")
        || lower.starts_with("built with")
        || lower.starts_with("input #")
        || lower.starts_with("output #")
        || lower.starts_with("metadata:")
        || lower.starts_with("encoder")
        || lower.starts_with("stream #")
        || lower.starts_with("duration:")
        || lower.starts_with("press [q]")
        || lower.starts_with("frame=")
        || lower.contains(" opening 'http")
        || lower.contains("found duplicated moov atom")
        || lower.contains("handler_name")
        || lower.contains("major_brand")
        || lower.contains("minor_version")
        || lower.contains("compatible_brands")
        || lower.contains("variant_bitrate")
        || lower.contains("video:")
}

fn parse_progress(line: &str) -> Option<JobProgress> {
    if let Some(progress) = parse_fetchr_progress(line) {
        return Some(progress);
    }

    let percent = RE_PERCENT
        .captures(line)
        .and_then(|c| c.name("p"))
        .and_then(|m| m.as_str().parse::<f32>().ok());

    let Some(p) = percent else {
        return None;
    };

    let speed = RE_SPEED
        .captures(line)
        .and_then(|c| c.name("s"))
        .map(|m| m.as_str().to_string());
    let eta = RE_ETA
        .captures(line)
        .and_then(|c| c.name("e"))
        .map(|m| m.as_str().to_string());
    let size = RE_SIZE
        .captures(line)
        .and_then(|c| c.name("sz"))
        .map(|m| m.as_str().to_string());
    let total_bytes = size.as_deref().and_then(parse_byte_amount);
    let downloaded_bytes =
        total_bytes.map(|total| ((total as f64) * (p as f64 / 100.0)).round() as u64);
    let speed_bps = speed
        .as_deref()
        .and_then(|value| parse_byte_amount(value.strip_suffix("/s").unwrap_or(value)))
        .map(|bytes| bytes as f64);
    let current_segment = RE_SEGMENT
        .captures(line)
        .and_then(|c| c.name("seg"))
        .map(|m| format!("Segment {}", m.as_str().replace(' ', "")));

    Some(JobProgress {
        percent: p.clamp(0.0, 100.0),
        stage_percent: None,
        stage_start: None,
        stage_end: None,
        stage_started_at: None,
        download_elapsed_ms: None,
        downloaded_bytes,
        total_bytes,
        speed_bps,
        current_segment,
        speed,
        eta,
        size,
        message: None,
    })
}

fn parse_fetchr_progress(line: &str) -> Option<JobProgress> {
    let start = line.find(FETCHR_PROGRESS_PREFIX)?;
    let payload = &line[start + FETCHR_PROGRESS_PREFIX.len()..];
    let mut parts = payload.split('|').map(str::trim);
    let downloaded_bytes = parts.next().and_then(parse_optional_u64);
    let total_bytes = parts.next().and_then(parse_optional_u64);
    let total_bytes_estimate = parts.next().and_then(parse_optional_u64);
    let speed_bps = parts.next().and_then(parse_optional_f64);
    let eta_seconds = parts.next().and_then(parse_optional_u64);
    let percent = parts.next().and_then(parse_optional_percent).or_else(|| {
        match (downloaded_bytes, total_bytes.or(total_bytes_estimate)) {
            (Some(done), Some(total)) if total > 0 => Some((done as f32 / total as f32) * 100.0),
            _ => None,
        }
    })?;
    let speed = parts.next().and_then(clean_progress_label);
    let eta = parts
        .next()
        .and_then(clean_progress_label)
        .or_else(|| eta_seconds.map(|seconds| format_duration(seconds as f64)));
    let size = parts.next().and_then(clean_progress_label);
    let total = total_bytes.or(total_bytes_estimate);

    Some(JobProgress {
        percent: percent.clamp(0.0, 100.0),
        stage_percent: None,
        stage_start: None,
        stage_end: None,
        stage_started_at: None,
        download_elapsed_ms: None,
        downloaded_bytes,
        total_bytes: total,
        speed_bps,
        current_segment: None,
        speed,
        eta,
        size,
        message: None,
    })
}

fn parse_optional_u64(value: &str) -> Option<u64> {
    let cleaned = value.trim();
    if is_missing_progress_value(cleaned) {
        return None;
    }
    cleaned
        .parse::<f64>()
        .ok()
        .map(|number| number.max(0.0).round() as u64)
}

fn parse_optional_f64(value: &str) -> Option<f64> {
    let cleaned = value.trim();
    if is_missing_progress_value(cleaned) {
        return None;
    }
    cleaned
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn parse_optional_percent(value: &str) -> Option<f32> {
    let cleaned = value.trim().trim_end_matches('%').trim();
    if is_missing_progress_value(cleaned) {
        return None;
    }
    cleaned
        .parse::<f32>()
        .ok()
        .filter(|number| number.is_finite())
}

fn clean_progress_label(value: &str) -> Option<String> {
    let cleaned = value.trim();
    if is_missing_progress_value(cleaned) {
        return None;
    }
    Some(cleaned.to_string())
}

fn is_missing_progress_value(value: &str) -> bool {
    value.is_empty()
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "none" | "na" | "n/a" | "unknown" | "null"
        )
}

fn parse_byte_amount(value: &str) -> Option<u64> {
    let captures = Regex::new(r"(?i)(?P<n>\d+(?:\.\d+)?)\s*(?P<u>[KMGT]?i?B)")
        .ok()?
        .captures(value.trim())?;
    let amount = captures.name("n")?.as_str().parse::<f64>().ok()?;
    let unit = captures.name("u")?.as_str().to_ascii_lowercase();
    let multiplier = if unit.starts_with('k') {
        1024_f64
    } else if unit.starts_with('m') {
        1024_f64.powi(2)
    } else if unit.starts_with('g') {
        1024_f64.powi(3)
    } else if unit.starts_with('t') {
        1024_f64.powi(4)
    } else {
        1.0
    };
    Some((amount * multiplier).round() as u64)
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

fn emit_log(queue: &Arc<QueueManager>, id: &str, line: &str) {
    queue.emit_job_log(id, line);
}

fn configure_ytdlp_env(cmd: &mut Command) {
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONLEGACYWINDOWSSTDIO", "0");
}

fn sanitize(name: &str) -> String {
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
        "download".to_string()
    } else {
        trimmed
    }
}
