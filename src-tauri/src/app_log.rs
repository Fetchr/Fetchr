use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::thread;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone)]
pub struct AppLogger {
    tx: Sender<LogRecord>,
}

#[derive(Debug, Serialize)]
pub struct LogRecord {
    pub time: String,
    pub ts: i64,
    pub level: LogLevel,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub traceback: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl AppLogger {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<LogRecord>();
        let path = create_log_path();
        let writer_path = path.clone();

        thread::Builder::new()
            .name("fetchr-log-writer".to_string())
            .spawn(move || {
                let Some(path) = writer_path else {
                    drain_without_writing(rx);
                    return;
                };

                let file = OpenOptions::new().create(true).append(true).open(&path);
                let Ok(file) = file else {
                    drain_without_writing(rx);
                    return;
                };

                let mut writer = BufWriter::new(file);
                for record in rx.iter() {
                    let line = match serde_json::to_string(&record) {
                        Ok(line) => line,
                        Err(err) => fallback_record("serialize_log_record", err.to_string()),
                    };
                    if writer.write_all(line.as_bytes()).is_err()
                        || writer.write_all(b"\n").is_err()
                    {
                        return;
                    }
                    let _ = writer.flush();
                }
            })
            .ok();

        let logger = Self { tx };
        logger.event(
            LogLevel::Info,
            "logger_started",
            None,
            Some(json!({ "file": path.map(|p| p.to_string_lossy().into_owned()) })),
        );
        logger
    }

    pub fn event(
        &self,
        level: LogLevel,
        action: impl Into<String>,
        message: Option<String>,
        input: Option<Value>,
    ) {
        self.write(LogRecord::new(level, action.into(), None, message, input));
    }

    pub fn job_event(
        &self,
        level: LogLevel,
        action: impl Into<String>,
        job_id: impl Into<String>,
        message: Option<String>,
        input: Option<Value>,
    ) {
        let mut record = LogRecord::new(level, action.into(), None, message, input);
        record.job_id = Some(job_id.into());
        self.write(record);
    }

    pub fn stdout(&self, job_id: &str, line: &str) {
        let mut record = LogRecord::new(
            LogLevel::Debug,
            "command_stdout".to_string(),
            None,
            None,
            None,
        );
        record.job_id = Some(job_id.to_string());
        record.stdout = Some(line.to_string());
        self.write(record);
    }

    pub fn stderr(&self, job_id: &str, line: &str) {
        let mut record = LogRecord::new(
            LogLevel::Warn,
            "command_stderr".to_string(),
            None,
            None,
            None,
        );
        record.job_id = Some(job_id.to_string());
        record.stderr = Some(line.to_string());
        self.write(record);
    }

    pub fn command_started(&self, job_id: &str, command: String, input: Option<Value>) {
        let mut record = LogRecord::new(
            LogLevel::Info,
            "command_started".to_string(),
            None,
            None,
            input,
        );
        record.job_id = Some(job_id.to_string());
        record.command = Some(command);
        self.write(record);
    }

    pub fn command_finished(&self, job_id: &str, command: String, exit_code: Option<i32>) {
        let mut record = LogRecord::new(
            if exit_code == Some(0) {
                LogLevel::Info
            } else {
                LogLevel::Error
            },
            "command_finished".to_string(),
            None,
            None,
            None,
        );
        record.job_id = Some(job_id.to_string());
        record.command = Some(command);
        record.exit_code = exit_code;
        self.write(record);
    }

    pub fn error(
        &self,
        action: impl Into<String>,
        job_id: Option<String>,
        error: String,
        traceback: Option<String>,
        input: Option<Value>,
    ) {
        let mut record = LogRecord::new(LogLevel::Error, action.into(), None, None, input);
        record.job_id = job_id;
        record.error = Some(error);
        record.traceback = traceback;
        self.write(record);
    }

    fn write(&self, record: LogRecord) {
        let _ = self.tx.send(record);
    }
}

impl Default for AppLogger {
    fn default() -> Self {
        Self::new()
    }
}

impl LogRecord {
    fn new(
        level: LogLevel,
        action: String,
        job_id: Option<String>,
        message: Option<String>,
        input: Option<Value>,
    ) -> Self {
        let now = Utc::now();
        Self {
            time: now.to_rfc3339_opts(SecondsFormat::Millis, true),
            ts: now.timestamp_millis(),
            level,
            action,
            job_id,
            message,
            input,
            command: None,
            stdout: None,
            stderr: None,
            exit_code: None,
            error: None,
            traceback: None,
        }
    }
}

fn create_log_path() -> Option<PathBuf> {
    let base = std::env::current_dir().ok()?;
    let dir = base.join("Logs");
    if fs::create_dir_all(&dir).is_err() {
        return None;
    }
    let name = format!("{}.jsonl", Utc::now().format("%Y-%m-%d_%H-%M-%S-%3f"));
    Some(dir.join(name))
}

fn fallback_record(action: &str, error: String) -> String {
    json!({
        "time": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        "ts": Utc::now().timestamp_millis(),
        "level": "error",
        "action": action,
        "error": error,
    })
    .to_string()
}

fn drain_without_writing(rx: mpsc::Receiver<LogRecord>) {
    for _ in rx {}
}
