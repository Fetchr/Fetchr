use std::path::{Path, PathBuf};

use serde::Serialize;

/// Names of the CLI tools we wrap.
pub const YTDLP: &str = "yt-dlp.exe";
pub const NM3U8DL: &str = "N_m3u8DL-RE.exe";
pub const FFMPEG: &str = "ffmpeg.exe";
pub const FFPROBE: &str = "ffprobe.exe";

#[derive(Debug, Clone, Serialize)]
pub struct BinaryReport {
    pub name: String,
    pub path: Option<String>,
    pub found: bool,
}

/// Resolve a binary's location using the following strategy:
/// 1. Explicit override directory (app settings) — passed in by caller.
/// 2. Directory of the current executable (production bundle).
/// 3. Parent of `src-tauri/` (development: the project root).
/// 4. Grandparent (the user's existing `yt-dlp/` folder).
/// 5. System PATH.
pub fn resolve_binary(name: &str, override_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = override_dir {
        let cand = dir.join(name);
        if cand.is_file() {
            return Some(cand);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let cand = parent.join(name);
            if cand.is_file() {
                return Some(cand);
            }

            for resource_dir in ["resources", "Resources"] {
                let cand = parent.join(resource_dir).join(name);
                if cand.is_file() {
                    return Some(cand);
                }
            }

            // dev: ../../ from src-tauri/target/debug/
            for up in [1u8, 2, 3, 4] {
                let mut p = parent.to_path_buf();
                for _ in 0..up {
                    if !p.pop() {
                        break;
                    }
                }
                let cand = p.join(name);
                if cand.is_file() {
                    return Some(cand);
                }

                for resource_dir in ["resources", "Resources"] {
                    let cand = p.join(resource_dir).join(name);
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
    }

    // Fallback: PATH
    which_on_path(name)
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let cand = dir.join(name);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// Tauri command — UI calls this on startup to verify bundled tools are present.
#[tauri::command]
pub fn detect_binaries(override_dir: Option<String>) -> Vec<BinaryReport> {
    let dir = override_dir.as_deref().map(Path::new);
    [YTDLP, NM3U8DL, FFMPEG, FFPROBE]
        .iter()
        .map(|name| {
            let path = resolve_binary(name, dir);
            BinaryReport {
                name: (*name).to_string(),
                path: path.as_ref().map(|p| p.display().to_string()),
                found: path.is_some(),
            }
        })
        .collect()
}
