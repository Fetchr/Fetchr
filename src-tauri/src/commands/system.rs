use serde::Serialize;

use crate::jobs::types::{GpuEncoderMode, PerformanceProfile, PerformanceSettings};

#[derive(Debug, Clone, Serialize)]
pub struct HardwarePreset {
    pub cpu_logical_cores: usize,
    pub gpu_names: Vec<String>,
    pub summary: String,
    pub performance: PerformanceSettings,
}

#[tauri::command]
pub fn detect_hardware_preset() -> HardwarePreset {
    let cpu_logical_cores = std::thread::available_parallelism()
        .map(|cores| cores.get())
        .unwrap_or(4);
    let gpu_names = detect_gpu_names();
    let gpu_encoder_mode = recommend_encoder(&gpu_names);
    let network_concurrent_fragments =
        recommend_network_threads(cpu_logical_cores, gpu_encoder_mode);
    let ffmpeg_preset = match gpu_encoder_mode {
        GpuEncoderMode::Nvenc => Some("p4".to_string()),
        GpuEncoderMode::Cpu => Some("veryfast".to_string()),
        _ => None,
    };
    let summary = format!(
        "{} cores, GPU: {}, encoder: {:?}, net: {}",
        cpu_logical_cores,
        if gpu_names.is_empty() {
            "not detected".to_string()
        } else {
            gpu_names.join(" / ")
        },
        gpu_encoder_mode,
        network_concurrent_fragments,
    );

    HardwarePreset {
        cpu_logical_cores,
        gpu_names,
        summary,
        performance: PerformanceSettings {
            profile: Some(PerformanceProfile::Maximum),
            network_concurrent_fragments: Some(network_concurrent_fragments),
            cpu_threads: None,
            render_workers: None,
            gpu_encoder_mode: Some(gpu_encoder_mode),
            ffmpeg_preset,
        },
    }
}

fn recommend_network_threads(cpu_logical_cores: usize, encoder: GpuEncoderMode) -> u32 {
    let base = if matches!(encoder, GpuEncoderMode::Cpu) {
        cpu_logical_cores.max(6)
    } else {
        cpu_logical_cores.saturating_mul(2).max(12)
    };
    base.min(32) as u32
}

fn recommend_encoder(gpu_names: &[String]) -> GpuEncoderMode {
    let joined = gpu_names.join(" ").to_ascii_lowercase();
    if joined.contains("nvidia") || joined.contains("geforce") || joined.contains("rtx") {
        return GpuEncoderMode::Nvenc;
    }
    if joined.contains("intel") && (joined.contains("xe") || joined.contains("arc")) {
        return GpuEncoderMode::IntelXeQsv;
    }
    if joined.contains("intel") {
        return GpuEncoderMode::Qsv;
    }
    if joined.contains("amd") || joined.contains("radeon") {
        return GpuEncoderMode::Amf;
    }
    GpuEncoderMode::Cpu
}

fn detect_gpu_names() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
            ])
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let names = text
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                if !names.is_empty() {
                    return names;
                }
            }
        }
    }

    Vec::new()
}

#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}
