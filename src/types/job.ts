export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

export type Mode = "vod" | "live";
export type JobKind = "video" | "chat";
export type DownloadKind = "video" | "audio";
export type ChatOverlayMode = "transparent_overlay" | "direct_render";
export type AlphaOutputFormat =
  | "mov_qtrle"
  | "webm_vp9"
  | "webm_vp8"
  | "ffv1_mkv"
  | "prores_4444"
  | "lagarith_avi";
export type ChatComposeMode = "direct" | "intermediate";
export type ChatFontStyle = "normal" | "italic" | "oblique";
export type ChatRenderCodec =
  | "raw_rgba_pipe"
  | "ffv1_mkv_alpha"
  | "qtrle_mov_rle"
  | "prores_4444"
  | "vp9_webm_alpha"
  | "lagarith_avi"
  | "solid_bg_fast";
export type FinalRenderMode = "full" | "blur_only" | "chat_only" | "separate_chat";
export type PerformanceProfile = "auto" | "maximum" | "turbo" | "custom";
export type GpuEncoderMode = "auto" | "intel_xe_qsv" | "nvenc" | "qsv" | "amf" | "cpu";
export type BlurEffect = "mosaic" | "gaussian_blur" | "image_overlay";
export type ImageFit = "contain" | "cover" | "stretch";
export type ScreenshotSource = "player" | "ffmpeg";

export interface ProxyConfig {
  enabled: boolean;
  url: string;
}

export interface JobMeta {
  title?: string | null;
  uploader?: string | null;
  platform?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  output_path?: string | null;
}

export interface TimeFragment {
  start: string;
  end: string;
}

export interface ChatOverlaySettings {
  enabled?: boolean | null;
  mode?: ChatOverlayMode | null;
  output_width?: number | null;
  output_height?: number | null;
  fps?: number | null;
  chat_x?: number | null;
  chat_y?: number | null;
  chat_width?: number | null;
  chat_height?: number | null;
  font_family?: string | null;
  font_weight?: number | null;
  font_style?: ChatFontStyle | null;
  username_font_weight?: number | null;
  username_font_style?: ChatFontStyle | null;
  font_size?: number | null;
  text_color?: string | null;
  outline_enabled?: boolean | null;
  outline_color?: string | null;
  outline_thickness?: number | null;
  background_enabled?: boolean | null;
  background_opacity?: number | null;
  show_badges?: boolean | null;
  show_timestamps?: boolean | null;
  show_avatars?: boolean | null;
  show_bttv?: boolean | null;
  show_ffz?: boolean | null;
  show_7tv?: boolean | null;
  max_visible_messages?: number | null;
  message_lifetime_sec?: number | null;
  direction?: "bottom-up" | "top-down" | null;
  alpha_output_format?: AlphaOutputFormat | null;
  chat_overlay_fps?: number | null;
  save_alpha_overlay?: boolean | null;
  save_clean_video?: boolean | null;
  compose_mode?: ChatComposeMode | null;
  render_codec?: ChatRenderCodec | null;
  final_render_mode?: FinalRenderMode | null;
  solid_background_color?: string | null;
}

export interface PerformanceSettings {
  profile: PerformanceProfile;
  network_concurrent_fragments: number;
  cpu_threads: number | null;
  render_workers: number | null;
  gpu_encoder_mode: GpuEncoderMode;
  ffmpeg_preset: string | null;
}

export interface BlurZone {
  id: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  effect: BlurEffect;
  intensity: number;
  image_path?: string | null;
  image_fit?: ImageFit | null;
}

export interface PreviewLayoutSettings {
  screenshot_source: ScreenshotSource;
  screenshot_time_sec: number | null;
  screenshot_path: string | null;
}

export interface JobSpec {
  url: string;
  chat_source_url?: string | null;
  name: string;
  directory: string;
  job_kind?: JobKind | null;
  mode: Mode;
  download_kind?: DownloadKind | null;
  start?: string | null;
  end?: string | null;
  fragments?: TimeFragment[];
  split?: boolean;
  split_interval_minutes?: number | null;
  quality?: string | null;
  quality_has_audio?: boolean | null;
  quality_has_video?: boolean | null;
  quality_height?: number | null;
  unmute_video?: boolean;
  proxy: ProxyConfig;
  chat_overlay?: ChatOverlaySettings | null;
  performance?: PerformanceSettings | null;
  blur_zones?: BlurZone[];
  binaries_dir?: string | null;
  meta?: JobMeta;
}

export interface JobProgress {
  percent: number;
  stage_percent?: number | null;
  stage_start?: number | null;
  stage_end?: number | null;
  stage_started_at?: number | null;
  download_elapsed_ms?: number | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  speed_bps?: number | null;
  current_segment?: string | null;
  speed?: string | null;
  eta?: string | null;
  size?: string | null;
  message?: string | null;
}

export interface Job {
  id: string;
  spec: JobSpec;
  status: JobStatus;
  progress: JobProgress;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  output_path?: string | null;
}

export interface TwitchHint {
  username: string | null;
  stream_id: string | null;
  source: string;
}

export interface FinderResult {
  urls: string[];
  tried: number;
  timestamp_utc: number;
}

export interface TrackerMeta {
  username: string | null;
  stream_id: string | null;
  start_time: string | null;
  title: string | null;
  thumbnail: string | null;
  candidates: string[];
}

export interface TwitchStreamListItem {
  date: string | null;
  start_time: string | null;
  title: string | null;
  duration_minutes: number | null;
  game: string | null;
  url: string | null;
  stream_id: string | null;
}

export interface TwitchStreamsPage {
  username: string;
  page: number;
  page_size: number;
  total: number;
  items: TwitchStreamListItem[];
}

export interface Quality {
  id: string;
  label: string;
  group?: "recommended" | "combined" | "video" | "audio" | "other" | null;
  height: number | null;
  fps: number | null;
  ext: string | null;
  has_audio: boolean;
  has_video: boolean;
  abr: number | null;
}

export interface ResolvedStream {
  platform: string;
  title: string | null;
  uploader: string | null;
  is_live: boolean;
  duration: number | null;
  qualities: Quality[];
  direct_url: string | null;
  thumbnail: string | null;
}

export interface PreviewSource {
  id: string | null;
  url: string;
  input_url: string;
  platform: string;
  transport: string;
  mode: string;
  message: string | null;
}

export interface BinaryReport {
  name: string;
  path: string | null;
  found: boolean;
}

export interface SystemFont {
  family: string;
  weights: number[];
  styles: ChatFontStyle[];
}
