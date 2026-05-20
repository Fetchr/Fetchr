use serde::{Deserialize, Serialize};

use crate::proxy::ProxyConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Paused,
    Done,
    Error,
    Cancelled,
}

impl JobStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            JobStatus::Done | JobStatus::Error | JobStatus::Cancelled
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// VOD — use yt-dlp for end-to-end.
    Vod,
    /// Live stream — resolve URL through yt-dlp, then record via N_m3u8DL-RE
    /// with the "ENDLIST" trick.
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobKind {
    Video,
    Chat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatOverlayMode {
    TransparentOverlay,
    DirectRender,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceProfile {
    Auto,
    Maximum,
    Turbo,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpuEncoderMode {
    Auto,
    IntelXeQsv,
    Nvenc,
    Qsv,
    Amf,
    Cpu,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceSettings {
    #[serde(default)]
    pub profile: Option<PerformanceProfile>,
    #[serde(default)]
    pub network_concurrent_fragments: Option<u32>,
    #[serde(default)]
    pub cpu_threads: Option<u32>,
    #[serde(default)]
    pub render_workers: Option<u32>,
    #[serde(default)]
    pub gpu_encoder_mode: Option<GpuEncoderMode>,
    #[serde(default)]
    pub ffmpeg_preset: Option<String>,
}

impl Default for PerformanceSettings {
    fn default() -> Self {
        Self {
            profile: Some(PerformanceProfile::Auto),
            network_concurrent_fragments: Some(8),
            cpu_threads: None,
            render_workers: None,
            gpu_encoder_mode: Some(GpuEncoderMode::Auto),
            ffmpeg_preset: None,
        }
    }
}

impl PerformanceSettings {
    pub fn with_defaults(mut self) -> Self {
        self.profile.get_or_insert(PerformanceProfile::Auto);
        let logical_cores = std::thread::available_parallelism()
            .map(|cores| cores.get() as u32)
            .unwrap_or(4);
        match self.profile {
            Some(PerformanceProfile::Turbo) => {
                self.network_concurrent_fragments.get_or_insert(32);
                self.cpu_threads.get_or_insert(logical_cores);
                self.render_workers.get_or_insert(logical_cores);
            }
            Some(PerformanceProfile::Maximum) => {
                self.network_concurrent_fragments.get_or_insert(16);
                if self.gpu_encoder_mode.is_none() {
                    self.gpu_encoder_mode = Some(GpuEncoderMode::IntelXeQsv);
                }
            }
            _ => {}
        }
        self.network_concurrent_fragments.get_or_insert(8);
        self.gpu_encoder_mode.get_or_insert(GpuEncoderMode::Auto);
        self
    }

    pub fn network_threads(&self) -> u32 {
        self.network_concurrent_fragments.unwrap_or(8).clamp(1, 32)
    }

    pub fn cpu_threads(&self) -> Option<u32> {
        self.cpu_threads.filter(|v| *v > 0).map(|v| v.clamp(1, 128))
    }

    pub fn is_turbo(&self) -> bool {
        self.profile == Some(PerformanceProfile::Turbo)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlurEffect {
    Mosaic,
    GaussianBlur,
    ImageOverlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFit {
    Contain,
    Cover,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRenderCodec {
    RawRgbaPipe,
    Ffv1MkvAlpha,
    QtrleMovRle,
    Prores4444,
    Vp9WebmAlpha,
    LagarithAvi,
    SolidBgFast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinalRenderMode {
    Full,
    BlurOnly,
    ChatOnly,
    SeparateChat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatFontStyle {
    Normal,
    Italic,
    Oblique,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlurZone {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub effect: BlurEffect,
    #[serde(default = "default_blur_intensity")]
    pub intensity: f32,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub image_fit: Option<ImageFit>,
}

fn default_true() -> bool {
    true
}

fn default_blur_intensity() -> f32 {
    8.0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatOverlaySettings {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub mode: Option<ChatOverlayMode>,
    #[serde(default)]
    pub output_width: Option<u32>,
    #[serde(default)]
    pub output_height: Option<u32>,
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default)]
    pub chat_x: Option<i32>,
    #[serde(default)]
    pub chat_y: Option<i32>,
    #[serde(default)]
    pub chat_width: Option<u32>,
    #[serde(default)]
    pub chat_height: Option<u32>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub font_weight: Option<u16>,
    #[serde(default)]
    pub font_style: Option<ChatFontStyle>,
    #[serde(default)]
    pub username_font_weight: Option<u16>,
    #[serde(default)]
    pub username_font_style: Option<ChatFontStyle>,
    #[serde(default)]
    pub font_size: Option<f32>,
    #[serde(default)]
    pub text_color: Option<String>,
    #[serde(default)]
    pub outline_enabled: Option<bool>,
    #[serde(default)]
    pub outline_color: Option<String>,
    #[serde(default)]
    pub outline_thickness: Option<u32>,
    #[serde(default)]
    pub background_enabled: Option<bool>,
    #[serde(default)]
    pub background_opacity: Option<f32>,
    #[serde(default)]
    pub show_badges: Option<bool>,
    #[serde(default)]
    pub show_timestamps: Option<bool>,
    #[serde(default)]
    pub show_avatars: Option<bool>,
    #[serde(default)]
    pub show_bttv: Option<bool>,
    #[serde(default)]
    pub show_ffz: Option<bool>,
    #[serde(default)]
    pub show_7tv: Option<bool>,
    #[serde(default)]
    pub max_visible_messages: Option<u32>,
    #[serde(default)]
    pub message_lifetime_sec: Option<f64>,
    #[serde(default)]
    pub chat_update_rate_sec: Option<f64>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub alpha_output_format: Option<AlphaOutputFormat>,
    #[serde(default)]
    pub chat_overlay_fps: Option<u32>,
    #[serde(default)]
    pub save_alpha_overlay: Option<bool>,
    #[serde(default)]
    pub save_clean_video: Option<bool>,
    #[serde(default)]
    pub compose_mode: Option<ChatComposeMode>,
    #[serde(default)]
    pub render_codec: Option<ChatRenderCodec>,
    #[serde(default)]
    pub final_render_mode: Option<FinalRenderMode>,
    #[serde(default)]
    pub solid_background_color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlphaOutputFormat {
    MovQtrle,
    WebmVp9,
    WebmVp8,
    Ffv1Mkv,
    Prores4444,
    LagarithAvi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatComposeMode {
    Direct,
    Intermediate,
}

impl ChatOverlaySettings {
    pub fn with_defaults(mut self) -> Self {
        self.enabled.get_or_insert(false);
        self.mode.get_or_insert(ChatOverlayMode::TransparentOverlay);
        self.output_width.get_or_insert(1920);
        self.output_height.get_or_insert(1080);
        self.fps.get_or_insert(60);
        self.chat_x.get_or_insert(80);
        self.chat_y.get_or_insert(760);
        self.chat_width.get_or_insert(1760);
        self.chat_height.get_or_insert(260);
        self.font_family.get_or_insert_with(|| "Inter".to_string());
        self.font_weight.get_or_insert(400);
        self.font_style.get_or_insert(ChatFontStyle::Normal);
        self.username_font_weight.get_or_insert(700);
        self.username_font_style
            .get_or_insert(ChatFontStyle::Normal);
        self.font_size.get_or_insert(24.0);
        self.text_color.get_or_insert_with(|| "#FFFFFF".to_string());
        self.outline_enabled.get_or_insert(true);
        self.outline_color
            .get_or_insert_with(|| "#000000".to_string());
        self.outline_thickness.get_or_insert(2);
        self.background_enabled.get_or_insert(false);
        self.background_opacity.get_or_insert(0.15);
        self.show_badges.get_or_insert(true);
        self.show_timestamps.get_or_insert(false);
        self.show_avatars.get_or_insert(false);
        self.show_bttv.get_or_insert(true);
        self.show_ffz.get_or_insert(true);
        self.show_7tv.get_or_insert(true);
        self.max_visible_messages.get_or_insert(14);
        self.message_lifetime_sec.get_or_insert(86400.0);
        self.chat_update_rate_sec.get_or_insert(0.2);
        self.direction
            .get_or_insert_with(|| "bottom-up".to_string());
        self.alpha_output_format
            .get_or_insert(AlphaOutputFormat::MovQtrle);
        self.chat_overlay_fps
            .get_or_insert_with(|| self.fps.unwrap_or(60));
        self.save_alpha_overlay.get_or_insert(false);
        self.save_clean_video.get_or_insert(true);
        self.compose_mode.get_or_insert(ChatComposeMode::Direct);
        self.render_codec
            .get_or_insert(ChatRenderCodec::RawRgbaPipe);
        self.final_render_mode.get_or_insert(FinalRenderMode::Full);
        self.solid_background_color
            .get_or_insert_with(|| "#212121".to_string());
        self
    }
}

/// Metadata collected during stream resolution (shown in the UI).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JobMeta {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub uploader: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    /// Final absolute path of the saved file (populated when job finishes).
    #[serde(default)]
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeFragment {
    pub start: String,
    pub end: String,
}

#[cfg(test)]
mod tests {
    use super::{GpuEncoderMode, PerformanceProfile, PerformanceSettings};

    #[test]
    fn turbo_profile_defaults_use_more_threads() {
        let performance = PerformanceSettings {
            profile: Some(PerformanceProfile::Turbo),
            network_concurrent_fragments: None,
            cpu_threads: None,
            render_workers: None,
            gpu_encoder_mode: Some(GpuEncoderMode::Auto),
            ffmpeg_preset: None,
        }
        .with_defaults();

        assert_eq!(performance.network_concurrent_fragments, Some(32));
        assert!(performance.cpu_threads.unwrap_or(0) >= 1);
        assert!(performance.render_workers.unwrap_or(0) >= 1);
        assert!(performance.is_turbo());
    }
}

/// Job specification coming in from the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub url: String,
    /// Optional source URL used only for chat replay extraction.
    /// This lets Twitch video download use a resolved HLS/m3u8 URL while
    /// chat still uses the original public Twitch VOD URL.
    #[serde(default)]
    pub chat_source_url: Option<String>,
    pub name: String,
    pub directory: String,
    #[serde(default)]
    pub job_kind: Option<JobKind>,
    pub mode: Mode,
    #[serde(default)]
    pub download_kind: Option<DownloadKind>,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub fragments: Vec<TimeFragment>,
    #[serde(default)]
    pub split: bool,
    #[serde(default)]
    pub split_interval_minutes: Option<u32>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub quality_has_audio: Option<bool>,
    #[serde(default)]
    pub quality_has_video: Option<bool>,
    #[serde(default)]
    pub quality_height: Option<u32>,
    #[serde(default)]
    pub unmute_video: bool,
    #[serde(default)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub chat_overlay: Option<ChatOverlaySettings>,
    #[serde(default)]
    pub performance: Option<PerformanceSettings>,
    #[serde(default)]
    pub blur_zones: Vec<BlurZone>,
    /// Optional override for the directory containing external binaries
    /// (yt-dlp.exe / N_m3u8DL-RE.exe / ffmpeg.exe).
    #[serde(default)]
    pub binaries_dir: Option<String>,
    #[serde(default)]
    pub meta: JobMeta,
}

/// Runtime progress snapshot emitted to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub percent: f32,
    #[serde(default)]
    pub stage_percent: Option<f32>,
    #[serde(default)]
    pub stage_start: Option<f32>,
    #[serde(default)]
    pub stage_end: Option<f32>,
    #[serde(default)]
    pub stage_started_at: Option<i64>,
    #[serde(default)]
    pub download_elapsed_ms: Option<i64>,
    #[serde(default)]
    pub downloaded_bytes: Option<u64>,
    #[serde(default)]
    pub total_bytes: Option<u64>,
    #[serde(default)]
    pub speed_bps: Option<f64>,
    #[serde(default)]
    pub current_segment: Option<String>,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub size: Option<String>,
    pub message: Option<String>,
}

impl Default for JobProgress {
    fn default() -> Self {
        Self {
            percent: 0.0,
            stage_percent: None,
            stage_start: None,
            stage_end: None,
            stage_started_at: None,
            download_elapsed_ms: None,
            downloaded_bytes: None,
            total_bytes: None,
            speed_bps: None,
            current_segment: None,
            speed: None,
            eta: None,
            size: None,
            message: None,
        }
    }
}

/// Full job state as stored in memory and sent to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub spec: JobSpec,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
}
