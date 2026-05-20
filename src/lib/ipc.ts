import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  BinaryReport,
  BlurZone,
  ChatOverlaySettings,
  FinderResult,
  Job,
  JobSpec,
  PerformanceSettings,
  PreviewSource,
  ProxyConfig,
  ResolvedStream,
  TrackerMeta,
  TwitchStreamsPage,
  TwitchHint,
  SystemFont,
} from "@/types/job";

export interface HardwarePreset {
  cpu_logical_cores: number;
  gpu_names: string[];
  summary: string;
  performance: PerformanceSettings;
}

export interface LicensePayload {
  v: number;
  product: string;
  machine_id: string;
  name: string | null;
  note: string | null;
  issued_at: string;
}

export interface LicenseStatus {
  state: "missing" | "active" | "invalid";
  machine_id: string;
  license: LicensePayload | null;
  message: string | null;
}

export interface BetaActivationLink {
  machine_id: string;
  telegram_url: string | null;
  start_parameter: string;
  configured: boolean;
  message: string | null;
}

export interface UpdateStatus {
  configured: boolean;
  available: boolean;
  current_version: string;
  version: string | null;
  notes: string | null;
  installer_url: string | null;
  installer_sha256: string | null;
  size_bytes: number | null;
  published_at: string | null;
  message: string | null;
}

export interface InstallUpdateResult {
  installer_path: string;
  launched: boolean;
}

export interface ImageFilePayload {
  bytes: number[];
  mime: string;
}

export const ipc = {
  // Resolve
  resolveStream: (
    url: string,
    proxy: ProxyConfig,
    binariesDir: string | null,
  ) =>
    invoke<ResolvedStream>("resolve_stream", {
      url,
      proxy,
      binariesDir,
    }),

  // Queue
  enqueueJob: (spec: JobSpec) => invoke<Job>("enqueue_job", { spec }),
  startQueue: (maxConcurrent?: number | null) =>
    invoke<void>("start_queue", { maxConcurrent: maxConcurrent ?? null }),
  pauseQueue: () => invoke<void>("pause_queue"),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  removeJob: (id: string) => invoke<boolean>("remove_job", { id }),
  moveJob: (id: string, direction: "up" | "down") =>
    invoke<boolean>("move_job", { id, direction }),
  listJobs: () => invoke<Job[]>("list_jobs"),
  clearCompleted: () => invoke<void>("clear_completed"),

  // FS
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  defaultDownloadDir: () => invoke<string>("default_download_dir"),
  chooseDirectory: () => invoke<string | null>("choose_directory"),
  chooseImageFile: () => invoke<string | null>("choose_image_file"),
  readImageFile: (path: string) => invoke<ImageFilePayload>("read_image_file", { path }),
  writeTextFile: (path: string, contents: string) =>
    invoke<void>("write_text_file", { path, contents }),
  saveTextFileDialog: (defaultName: string, contents: string) =>
    invoke<string | null>("save_text_file_dialog", { defaultName, contents }),

  // Binaries
  detectBinaries: (overrideDir: string | null) =>
    invoke<BinaryReport[]>("detect_binaries", { overrideDir }),
  listSystemFonts: () => invoke<SystemFont[]>("list_system_fonts"),
  detectHardwarePreset: () => invoke<HardwarePreset>("detect_hardware_preset"),
  getMachineId: () => invoke<string>("get_machine_id"),
  betaActivationLink: () => invoke<BetaActivationLink>("beta_activation_link"),
  licenseStatus: () => invoke<LicenseStatus>("license_status"),
  activateLicense: (key: string) => invoke<LicenseStatus>("activate_license", { key }),
  resetLicense: () => invoke<LicenseStatus>("reset_license"),
  checkForUpdate: () => invoke<UpdateStatus>("check_for_update"),
  installUpdate: (installerUrl: string, installerSha256?: string | null) =>
    invoke<InstallUpdateResult>("install_update", {
      installerUrl,
      installerSha256: installerSha256 ?? null,
    }),

  // Resolve a playable direct HLS URL (for in-app preview).
  resolveDirectUrl: (
    url: string,
    proxy: ProxyConfig,
    binariesDir: string | null,
    quality: string | null,
  ) =>
    invoke<string>("resolve_direct_url", {
      url,
      proxy,
      binariesDir,
      quality,
    }),

  // Proxy a text fetch through Rust (side-steps WebView CORS + Origin
  // restrictions that break direct hls.js manifest loads).
  fetchText: (url: string, referer?: string | null) =>
    invoke<string>("fetch_text", { url, referer: referer ?? null }),
  fetchBytes: (
    url: string,
    referer?: string | null,
    rangeStart?: number | null,
    rangeEnd?: number | null,
  ) =>
    invoke<number[]>("fetch_bytes", {
      url,
      referer: referer ?? null,
      rangeStart: rangeStart ?? null,
      rangeEnd: rangeEnd ?? null,
    }),
  proxiedHlsUrl: (url: string, referer?: string | null) =>
    invoke<string>("proxied_hls_url", { url, referer: referer ?? null }),
  startStreamPreview: (
    url: string,
    proxy: ProxyConfig,
    binariesDir: string | null,
    quality: string | null,
  ) =>
    invoke<PreviewSource>("start_stream_preview", {
      url,
      proxy,
      binariesDir,
      quality,
    }),
  stopStreamPreview: (id: string) =>
    invoke<void>("stop_stream_preview", { id }),
  capturePreviewFrame: (req: {
    url: string;
    timeSec: number;
    outputWidth?: number | null;
    outputHeight?: number | null;
    quality?: string | null;
    proxy: ProxyConfig;
    binariesDir: string | null;
  }) =>
    invoke<{ path: string; url: string; time_sec: number; width: number; height: number }>(
      "capture_preview_frame",
      {
        url: req.url,
        timeSec: req.timeSec,
        outputWidth: req.outputWidth ?? null,
        outputHeight: req.outputHeight ?? null,
        quality: req.quality ?? null,
        proxy: req.proxy,
        binariesDir: req.binariesDir,
      },
    ),
  validateChatRenderScreenshotUrl: (url: string) =>
    invoke<{ path: string; url: string; time_sec: number; width: number; height: number }>(
      "validate_chat_render_screenshot_url",
      { url },
    ),
  chatRenderLogAction: (action: string, input?: unknown) =>
    invoke<void>("chat_render_log_action", { action, input: input ?? null }),
  renderChatJson: (req: {
    chatJsonPath: string;
    outputDirectory: string;
    outputName: string;
    chatOverlay: ChatOverlaySettings;
    performance: PerformanceSettings;
    binariesDir?: string | null;
  }) =>
    invoke<{ output_path: string }>("render_chat_json", {
      req: {
        chat_json_path: req.chatJsonPath,
        output_directory: req.outputDirectory,
        output_name: req.outputName,
        chat_overlay: req.chatOverlay,
        performance: req.performance,
        binaries_dir: req.binariesDir ?? null,
      },
    }),
  saveOverlayLayoutFromPreview: (req: {
    chatOverlay: ChatOverlaySettings;
    blurZones: BlurZone[];
  }) =>
    invoke<boolean>("save_overlay_layout_from_preview", {
      chatOverlay: req.chatOverlay,
      blurZones: req.blurZones,
    }),

  // Twitch m3u8 helpers
  twitchParseUrl: (url: string) =>
    invoke<TwitchHint>("twitch_parse_url", { url }),
  twitchTrackerFetch: (url: string) =>
    invoke<TrackerMeta>("twitch_tracker_fetch", { url }),
  twitchTrackerStreams: (req: {
    username: string;
    page?: number | null;
    page_size?: number | null;
  }) => invoke<TwitchStreamsPage>("twitch_tracker_streams", { req }),
  twitchFinderLogAction: (action: string, input?: unknown) =>
    invoke<void>("twitch_finder_log_action", { action, input: input ?? null }),
  twitchFindM3u8: (req: {
    username: string;
    stream_id: string;
    start_time: string;
    timezone?: string | null;
    window?: number | null;
  }) => invoke<FinderResult>("twitch_find_m3u8", { req }),
};

/** Subscribe to queue state snapshots emitted by the Rust backend. */
export function onQueueChanged(
  cb: (jobs: Job[]) => void,
): Promise<UnlistenFn> {
  return listen<Job[]>("queue:changed", (event) => cb(event.payload));
}

export interface LogLine {
  id: string;
  line: string;
  ts: number;
}

/** Subscribe to raw log lines from every running job. */
export function onJobLog(
  cb: (log: LogLine) => void,
): Promise<UnlistenFn> {
  return listen<LogLine>("job:log", (event) => cb(event.payload));
}
