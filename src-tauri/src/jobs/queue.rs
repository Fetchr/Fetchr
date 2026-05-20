use std::sync::Arc;

use chrono::Utc;
use parking_lot::Mutex;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::app_log::{AppLogger, LogLevel};

use super::runner::run_job;
use super::types::{Job, JobProgress, JobSpec, JobStatus};

const EVENT_QUEUE_CHANGED: &str = "queue:changed";
const EVENT_LOG: &str = "job:log";

#[derive(Default)]
struct Inner {
    jobs: Vec<Job>,
    running: std::collections::HashSet<String>,
    paused: bool,
    draining: bool,
    max_concurrent: usize,
    cancel_flags: std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>,
    progress_stages: std::collections::HashMap<String, (f32, f32, i64)>,
}

pub struct QueueManager {
    inner: Mutex<Inner>,
    app: AppHandle,
    logger: AppLogger,
}

impl QueueManager {
    pub fn new(app: AppHandle, logger: AppLogger) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            app,
            logger,
        }
    }

    fn emit_changed(&self) {
        let snapshot = self.list();
        let _ = self.app.emit(EVENT_QUEUE_CHANGED, &snapshot);
    }

    pub fn enqueue(&self, spec: JobSpec) -> Job {
        let id = Uuid::new_v4().to_string();
        self.logger.job_event(
            LogLevel::Info,
            "job_enqueue",
            id.clone(),
            Some("Job queued".to_string()),
            Some(json!({ "spec": spec.clone() })),
        );
        let job = Job {
            id: id.clone(),
            spec,
            status: JobStatus::Queued,
            progress: JobProgress::default(),
            created_at: Utc::now().timestamp_millis(),
            started_at: None,
            finished_at: None,
            error: None,
            output_path: None,
        };
        self.inner.lock().jobs.push(job.clone());
        self.emit_changed();
        job
    }

    pub fn list(&self) -> Vec<Job> {
        self.inner.lock().jobs.clone()
    }

    pub fn remove(&self, id: &str) -> bool {
        let mut g = self.inner.lock();
        if g.running.contains(id) {
            return false;
        }
        let before = g.jobs.len();
        g.jobs.retain(|j| j.id != id);
        let changed = g.jobs.len() != before;
        drop(g);
        if changed {
            self.logger.job_event(
                LogLevel::Info,
                "job_remove",
                id.to_string(),
                Some("Job removed from queue".to_string()),
                None,
            );
            self.emit_changed();
        }
        changed
    }

    pub fn move_job(&self, id: &str, direction: &str) -> bool {
        let mut g = self.inner.lock();
        if g.running.contains(id) {
            return false;
        }
        let Some(index) = g.jobs.iter().position(|j| j.id == id) else {
            return false;
        };
        if g.jobs[index].status != JobStatus::Queued {
            return false;
        }
        let target = match direction {
            "up" if index > 0 => index - 1,
            "down" if index + 1 < g.jobs.len() => index + 1,
            _ => return false,
        };
        if g.jobs[target].status == JobStatus::Running {
            return false;
        }
        g.jobs.swap(index, target);
        drop(g);
        self.emit_changed();
        true
    }

    pub fn clear_completed(&self) {
        let mut g = self.inner.lock();
        g.jobs.retain(|j| !j.status.is_terminal());
        drop(g);
        self.emit_changed();
    }

    pub fn cancel(&self, id: &str) {
        let mut g = self.inner.lock();
        if let Some(flag) = g.cancel_flags.get(id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            if job.status == JobStatus::Queued {
                job.status = JobStatus::Cancelled;
            }
        }
        drop(g);
        self.logger.job_event(
            LogLevel::Warn,
            "job_cancel_requested",
            id.to_string(),
            Some("Cancel requested".to_string()),
            None,
        );
        self.emit_changed();
    }

    pub fn pause(&self) {
        self.inner.lock().paused = true;
        self.logger.event(
            LogLevel::Info,
            "queue_pause",
            Some("Queue paused".to_string()),
            None,
        );
    }

    pub fn set_output_path(&self, id: &str, path: String) {
        let file_size = std::fs::metadata(&path).ok().map(|meta| meta.len());
        let mut g = self.inner.lock();
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            job.output_path = Some(path);
            if let Some(bytes) = file_size {
                job.progress.size = Some(format_bytes(bytes));
            }
        }
        drop(g);
        self.emit_changed();
    }

    pub fn set_progress(&self, id: &str, progress: JobProgress) {
        let mut g = self.inner.lock();
        let (stage_start, stage_end, stage_started_at) = g
            .progress_stages
            .get(id)
            .copied()
            .unwrap_or((0.0, 100.0, Utc::now().timestamp_millis()));
        let span = (stage_end - stage_start).max(0.0);
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            let download_elapsed_ms = progress
                .download_elapsed_ms
                .or(job.progress.download_elapsed_ms);
            let speed = progress
                .speed
                .clone()
                .or_else(|| job.progress.speed.clone());
            let eta = progress.eta.clone().or_else(|| job.progress.eta.clone());
            let size = progress.size.clone().or_else(|| job.progress.size.clone());
            let downloaded_bytes = progress.downloaded_bytes.or(job.progress.downloaded_bytes);
            let total_bytes = progress.total_bytes.or(job.progress.total_bytes);
            let speed_bps = progress.speed_bps.or(job.progress.speed_bps);
            let current_segment = progress
                .current_segment
                .clone()
                .or_else(|| job.progress.current_segment.clone());
            let message = progress
                .message
                .clone()
                .or_else(|| job.progress.message.clone());
            job.progress = JobProgress {
                percent: (stage_start + progress.percent.clamp(0.0, 100.0) * span / 100.0)
                    .clamp(0.0, 100.0),
                stage_percent: Some(progress.percent.clamp(0.0, 100.0)),
                stage_start: Some(stage_start),
                stage_end: Some(stage_end),
                stage_started_at: Some(stage_started_at),
                download_elapsed_ms,
                downloaded_bytes,
                total_bytes,
                speed_bps,
                current_segment,
                speed,
                eta,
                size,
                message,
                ..progress
            };
        }
        drop(g);
        self.emit_changed();
    }

    pub fn set_progress_stage(&self, id: &str, start: f32, end: f32, message: Option<String>) {
        let start = start.clamp(0.0, 100.0);
        let end = end.clamp(start, 100.0);
        let mut g = self.inner.lock();
        let stage_started_at = Utc::now().timestamp_millis();
        g.progress_stages
            .insert(id.to_string(), (start, end, stage_started_at));
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            let download_elapsed_ms = job.progress.download_elapsed_ms;
            let speed = job.progress.speed.clone();
            let eta = job.progress.eta.clone();
            let size = job.progress.size.clone();
            let downloaded_bytes = job.progress.downloaded_bytes;
            let total_bytes = job.progress.total_bytes;
            let speed_bps = job.progress.speed_bps;
            let current_segment = job.progress.current_segment.clone();
            job.progress = JobProgress {
                percent: start,
                stage_percent: Some(0.0),
                stage_start: Some(start),
                stage_end: Some(end),
                stage_started_at: Some(stage_started_at),
                download_elapsed_ms,
                downloaded_bytes,
                total_bytes,
                speed_bps,
                current_segment,
                speed,
                eta,
                size,
                message,
            };
        }
        drop(g);
        self.emit_changed();
    }

    pub fn set_download_elapsed(&self, id: &str, elapsed_ms: i64) {
        let mut g = self.inner.lock();
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            job.progress.download_elapsed_ms = Some(elapsed_ms.max(0));
        }
        drop(g);
        self.emit_changed();
    }

    pub fn set_status(&self, id: &str, status: JobStatus, err: Option<String>) {
        let err_for_log = err.clone();
        let mut g = self.inner.lock();
        if let Some(job) = g.jobs.iter_mut().find(|j| j.id == id) {
            job.status = status;
            if status == JobStatus::Running && job.started_at.is_none() {
                job.started_at = Some(Utc::now().timestamp_millis());
            }
            if status.is_terminal() {
                job.finished_at = Some(Utc::now().timestamp_millis());
                if let Some(e) = err {
                    job.error = Some(e);
                }
            }
        }
        drop(g);
        if status.is_terminal() || status == JobStatus::Running {
            self.logger.job_event(
                if matches!(status, JobStatus::Error) {
                    LogLevel::Error
                } else {
                    LogLevel::Info
                },
                "job_status",
                id.to_string(),
                Some(format!("Job status: {status:?}")),
                Some(json!({
                    "status": status,
                    "error": err_for_log,
                })),
            );
        }
        self.emit_changed();
    }

    fn finish_job(&self, id: &str, result: Result<(), JobFailure>) {
        match result {
            Ok(()) => {
                self.set_status(id, JobStatus::Done, None);
                if let Some(job) = self
                    .inner
                    .lock()
                    .jobs
                    .iter()
                    .find(|job| job.id == id)
                    .cloned()
                {
                    crate::telemetry::track_download_completed(job);
                }
            }
            Err(failure) => {
                let cancelled = self
                    .inner
                    .lock()
                    .cancel_flags
                    .get(id)
                    .map(|f| f.load(std::sync::atomic::Ordering::SeqCst))
                    .unwrap_or(false);
                self.logger.error(
                    "job_failed",
                    Some(id.to_string()),
                    failure.message.clone(),
                    Some(failure.traceback.clone()),
                    None,
                );
                if cancelled {
                    self.set_status(id, JobStatus::Cancelled, Some(failure.message));
                } else {
                    self.set_status(id, JobStatus::Error, Some(failure.message));
                }
            }
        }

        let mut g = self.inner.lock();
        g.cancel_flags.remove(id);
        g.progress_stages.remove(id);
        g.running.remove(id);
        drop(g);
        self.emit_changed();
    }

    /// Drain queued jobs up to the configured concurrency limit.
    pub async fn start(self: Arc<Self>) {
        loop {
            let next_batch = {
                let mut g = self.inner.lock();
                if g.paused {
                    g.draining = false;
                    Vec::new()
                } else {
                    let limit = g.max_concurrent.max(1);
                    let available = limit.saturating_sub(g.running.len());
                    let batch: Vec<Job> = g
                        .jobs
                        .iter()
                        .filter(|j| j.status == JobStatus::Queued)
                        .take(available)
                        .cloned()
                        .collect();

                    for job in &batch {
                        g.running.insert(job.id.clone());
                        let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
                        g.cancel_flags.insert(job.id.clone(), flag);
                    }

                    if batch.is_empty() && g.running.is_empty() {
                        g.draining = false;
                    }
                    batch
                }
            };

            if next_batch.is_empty() {
                let done = {
                    let g = self.inner.lock();
                    !g.draining || (!g.paused && g.running.is_empty())
                };
                if done {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                continue;
            }

            for job in next_batch {
                let q = self.clone();
                tauri::async_runtime::spawn(async move {
                    let id = job.id.clone();
                    q.set_status(&id, JobStatus::Running, None);
                    q.logger.job_event(
                        LogLevel::Info,
                        "job_started",
                        id.clone(),
                        Some("Job started".to_string()),
                        Some(json!({ "job": job })),
                    );

                    let cancel_flag = {
                        let g = q.inner.lock();
                        g.cancel_flags.get(&id).cloned()
                    };

                    let result = run_job(
                        q.clone(),
                        job,
                        cancel_flag
                            .unwrap_or_else(|| Arc::new(std::sync::atomic::AtomicBool::new(false))),
                    )
                    .await
                    .map_err(JobFailure::from);

                    q.finish_job(&id, result);
                });
            }

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    pub fn resume(self: Arc<Self>, max_concurrent: usize) {
        let should_spawn = {
            let mut g = self.inner.lock();
            g.paused = false;
            g.max_concurrent = max_concurrent.max(1).min(6);
            if g.draining {
                false
            } else {
                g.draining = true;
                true
            }
        };

        if should_spawn {
            let me = self.clone();
            tauri::async_runtime::spawn(async move {
                me.start().await;
            });
        }
    }

    pub fn app_handle(&self) -> tauri::AppHandle {
        self.app.clone()
    }

    pub fn emit_job_log(&self, id: &str, line: &str) {
        #[derive(serde::Serialize, Clone)]
        struct LogLine<'a> {
            id: &'a str,
            line: String,
            ts: i64,
        }

        let payload = LogLine {
            id,
            line: compact_ui_line(line),
            ts: Utc::now().timestamp_millis(),
        };
        let _ = self.app.emit(EVENT_LOG, payload);

        let level = if line.starts_with("!!") {
            LogLevel::Warn
        } else if line_is_process_warning(line) {
            LogLevel::Warn
        } else {
            LogLevel::Info
        };
        if let Some(stderr) = line.strip_prefix("!! ") {
            self.logger.stderr(id, stderr);
        }
        self.logger.job_event(
            level,
            "job_log",
            id.to_string(),
            Some(line.to_string()),
            None,
        );
    }

    pub fn log_stdout(&self, id: &str, line: &str) {
        self.logger.stdout(id, line);
    }

    pub fn log_stderr(&self, id: &str, line: &str) {
        self.logger.stderr(id, line);
    }

    pub fn log_command_started(&self, id: &str, command: String, input: Option<serde_json::Value>) {
        self.logger.command_started(id, command, input);
    }

    pub fn log_command_finished(&self, id: &str, command: String, exit_code: Option<i32>) {
        self.logger.command_finished(id, command, exit_code);
    }

    pub fn emit_app_log(
        &self,
        level: LogLevel,
        action: &str,
        message: impl Into<String>,
        input: Option<serde_json::Value>,
    ) {
        let message = message.into();
        #[derive(serde::Serialize, Clone)]
        struct LogLine<'a> {
            id: &'a str,
            line: String,
            ts: i64,
        }

        let payload = LogLine {
            id: "system",
            line: compact_ui_line(&format!("{action}: {message}")),
            ts: Utc::now().timestamp_millis(),
        };
        let _ = self.app.emit(EVENT_LOG, payload);
        self.logger
            .event(level, action.to_string(), Some(message), input);
    }

    pub fn emit_app_error(
        &self,
        action: &str,
        error: impl Into<String>,
        traceback: Option<String>,
        input: Option<serde_json::Value>,
    ) {
        let error = error.into();
        #[derive(serde::Serialize, Clone)]
        struct LogLine<'a> {
            id: &'a str,
            line: String,
            ts: i64,
        }

        let payload = LogLine {
            id: "system",
            line: compact_ui_line(&format!("{action}: ERROR: {error}")),
            ts: Utc::now().timestamp_millis(),
        };
        let _ = self.app.emit(EVENT_LOG, payload);
        self.logger
            .error(action.to_string(), None, error, traceback, input);
    }
}

fn line_is_process_warning(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("warn")
        || lower.contains("fallback")
        || lower.contains("skipped")
        || lower.contains("deprecated")
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit_index = 0usize;
    while value >= 1024.0 && unit_index + 1 < UNITS.len() {
        value /= 1024.0;
        unit_index += 1;
    }
    if unit_index == 0 {
        format!("{bytes} {}", UNITS[unit_index])
    } else {
        format!("{value:.2} {}", UNITS[unit_index])
    }
}

#[derive(Debug)]
struct JobFailure {
    message: String,
    traceback: String,
}

impl From<anyhow::Error> for JobFailure {
    fn from(error: anyhow::Error) -> Self {
        Self {
            message: error.to_string(),
            traceback: format!("{error:?}"),
        }
    }
}

fn compact_ui_line(line: &str) -> String {
    const MAX_UI_CHARS: usize = 4000;
    if line.chars().count() <= MAX_UI_CHARS {
        return line.to_string();
    }
    let mut out: String = line.chars().take(MAX_UI_CHARS).collect();
    out.push_str(" ... [truncated in UI, full line saved to file]");
    out
}
