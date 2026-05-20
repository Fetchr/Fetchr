import { create } from "zustand";
import { persist } from "zustand/middleware";

import type {
  BlurZone,
  ChatOverlaySettings,
  PerformanceSettings,
  PreviewLayoutSettings,
  ProxyConfig,
} from "@/types/job";

export const defaultChatOverlaySettings: ChatOverlaySettings = {
  enabled: false,
  mode: "transparent_overlay",
  output_width: 1920,
  output_height: 1080,
  fps: 60,
  chat_x: 80,
  chat_y: 760,
  chat_width: 1760,
  chat_height: 260,
  font_family: "Inter",
  font_weight: 400,
  font_style: "normal",
  username_font_weight: 700,
  username_font_style: "normal",
  font_size: 24,
  text_color: "#FFFFFF",
  outline_enabled: true,
  outline_color: "#000000",
  outline_thickness: 2,
  background_enabled: false,
  background_opacity: 0.15,
  show_badges: true,
  show_timestamps: false,
  show_avatars: false,
  show_bttv: true,
  show_ffz: true,
  show_7tv: true,
  max_visible_messages: 14,
  message_lifetime_sec: 86400,
  direction: "bottom-up",
  alpha_output_format: "mov_qtrle",
  chat_overlay_fps: 60,
  save_alpha_overlay: false,
  save_clean_video: true,
  compose_mode: "direct",
  render_codec: "raw_rgba_pipe",
  final_render_mode: "full",
  solid_background_color: "#212121",
};

export const defaultPerformanceSettings: PerformanceSettings = {
  profile: "auto",
  network_concurrent_fragments: 8,
  cpu_threads: null,
  render_workers: null,
  gpu_encoder_mode: "auto",
  ffmpeg_preset: null,
};

export const defaultPreviewLayoutSettings: PreviewLayoutSettings = {
  screenshot_source: "ffmpeg",
  screenshot_time_sec: null,
  screenshot_path: null,
};

export interface IntegrationSettings {
  twitchClientId: string;
  twitchAuthStatus: "not_configured" | "configured";
  kickAuthStatus: "not_configured" | "public";
  chatExportFolder: string;
  remoteImageLoading: boolean;
  cacheRemoteEmotes: boolean;
}

export const defaultIntegrationSettings: IntegrationSettings = {
  twitchClientId: "",
  twitchAuthStatus: "not_configured",
  kickAuthStatus: "public",
  chatExportFolder: "",
  remoteImageLoading: true,
  cacheRemoteEmotes: true,
};

interface SettingsState {
  directory: string;
  filenameTemplate: string;
  binariesDir: string | null;
  maxConcurrentJobs: number;
  proxy: ProxyConfig;
  chatOverlay: ChatOverlaySettings;
  performance: PerformanceSettings;
  blurZones: BlurZone[];
  sponsorBlurEnabled: boolean;
  sponsorBlurReferencePath: string | null;
  previewLayout: PreviewLayoutSettings;
  integrations: IntegrationSettings;
  locale: "ru" | "en";
  setDirectory: (v: string) => void;
  setFilenameTemplate: (v: string) => void;
  setBinariesDir: (v: string | null) => void;
  setMaxConcurrentJobs: (v: number) => void;
  setProxy: (v: ProxyConfig) => void;
  setChatOverlay: (v: ChatOverlaySettings) => void;
  setPerformance: (v: PerformanceSettings) => void;
  setBlurZones: (v: BlurZone[]) => void;
  setSponsorBlurEnabled: (v: boolean) => void;
  setSponsorBlurReferencePath: (v: string | null) => void;
  setPreviewLayout: (v: PreviewLayoutSettings) => void;
  setIntegrations: (v: IntegrationSettings) => void;
  setLocale: (v: "ru" | "en") => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      directory: "",
      filenameTemplate: "Stream_{title}",
      binariesDir: null,
      maxConcurrentJobs: 1,
      proxy: { enabled: false, url: "http://127.0.0.1:2080" },
      chatOverlay: defaultChatOverlaySettings,
      performance: defaultPerformanceSettings,
      blurZones: [],
      sponsorBlurEnabled: false,
      sponsorBlurReferencePath: null,
      previewLayout: defaultPreviewLayoutSettings,
      integrations: defaultIntegrationSettings,
      locale: "ru",
      setDirectory: (v) => set({ directory: v }),
      setFilenameTemplate: (v) => set({ filenameTemplate: v }),
      setBinariesDir: (v) => set({ binariesDir: v }),
      setMaxConcurrentJobs: (v) =>
        set({ maxConcurrentJobs: Math.max(1, Math.min(6, Math.floor(v) || 1)) }),
      setProxy: (v) => set({ proxy: v }),
      setChatOverlay: (v) => set({ chatOverlay: { ...defaultChatOverlaySettings, ...v } }),
      setPerformance: (v) => set({ performance: { ...defaultPerformanceSettings, ...v } }),
      setBlurZones: (v) => set({ blurZones: v }),
      setSponsorBlurEnabled: (v) => set({ sponsorBlurEnabled: v }),
      setSponsorBlurReferencePath: (v) => set({ sponsorBlurReferencePath: v }),
      setPreviewLayout: (v) => set({ previewLayout: { ...defaultPreviewLayoutSettings, ...v } }),
      setIntegrations: (v) =>
        set({ integrations: { ...defaultIntegrationSettings, ...v } }),
      setLocale: (v) => set({ locale: v }),
    }),
    {
      name: "fetchr-settings",
      version: 8,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsState>;
        if (version < 2) {
          state.chatOverlay = {
            ...defaultChatOverlaySettings,
            ...state.chatOverlay,
            alpha_output_format: "mov_qtrle",
            chat_overlay_fps: 60,
            save_alpha_overlay: true,
            compose_mode: "intermediate",
          };
        }
        if (version < 3 && state.chatOverlay) {
          const oldVerticalDefault =
            (state.chatOverlay.chat_x ?? 1600) === 1600 &&
            (state.chatOverlay.chat_y ?? 260) === 260 &&
            (state.chatOverlay.chat_width ?? 290) === 290 &&
            (state.chatOverlay.chat_height ?? 640) === 640;
          state.chatOverlay = {
            ...defaultChatOverlaySettings,
            ...state.chatOverlay,
            ...(oldVerticalDefault
              ? {
                  chat_x: defaultChatOverlaySettings.chat_x,
                  chat_y: defaultChatOverlaySettings.chat_y,
                  chat_width: defaultChatOverlaySettings.chat_width,
                  chat_height: defaultChatOverlaySettings.chat_height,
                }
              : {}),
          };
        }
        if (version < 4) {
          state.sponsorBlurEnabled = false;
          state.sponsorBlurReferencePath = null;
        }
        if (version < 5) {
          state.chatOverlay = {
            ...defaultChatOverlaySettings,
            ...state.chatOverlay,
            compose_mode: "direct",
            save_alpha_overlay: false,
          };
        }
        if (version < 6) {
          state.chatOverlay = {
            ...defaultChatOverlaySettings,
            ...state.chatOverlay,
            render_codec: state.chatOverlay?.render_codec ?? "raw_rgba_pipe",
            final_render_mode: state.chatOverlay?.final_render_mode ?? "full",
            solid_background_color: state.chatOverlay?.solid_background_color ?? "#212121",
          };
        }
        if (version < 7) {
          state.chatOverlay = {
            ...defaultChatOverlaySettings,
            ...state.chatOverlay,
            message_lifetime_sec: 86400,
          };
        }
        if (version < 8) {
          state.integrations = {
            ...defaultIntegrationSettings,
            chatExportFolder: state.directory ?? "",
          };
        }
        state.integrations = {
          ...defaultIntegrationSettings,
          ...state.integrations,
        };
        return state;
      },
    },
  ),
);
