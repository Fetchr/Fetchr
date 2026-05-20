import { create } from "zustand";
import { persist } from "zustand/middleware";

import { defaultChatOverlaySettings } from "@/stores/settings";
import type { BlurZone, ChatOverlaySettings } from "@/types/job";

export interface M3U8StreamerPreset {
  id: string;
  name: string;
  streamer: string;
  history: string[];
  updatedAt: string;
}

export interface ChatRenderPreset {
  id: string;
  name: string;
  overlay: ChatOverlaySettings;
  updatedAt: string;
}

export interface SponsorBlurPreset {
  id: string;
  name: string;
  zones: BlurZone[];
  enabled: boolean;
  referencePath: string | null;
  updatedAt: string;
}

interface WorkflowPresetsState {
  activeM3u8PresetId: string | null;
  m3u8Presets: M3U8StreamerPreset[];
  activeChatPresetId: string;
  chatPresets: ChatRenderPreset[];
  activeSponsorPresetId: string;
  sponsorPresets: SponsorBlurPreset[];
  setActiveM3u8Preset: (id: string | null) => void;
  createM3u8Preset: (sourceId?: string | null) => string;
  renameM3u8Preset: (id: string, name: string) => void;
  updateM3u8Preset: (id: string, patch: Partial<Pick<M3U8StreamerPreset, "name" | "streamer">>) => void;
  rememberM3u8Streamer: (id: string, streamer: string) => void;
  setActiveChatPreset: (id: string) => void;
  createChatPreset: (sourceId?: string | null) => string;
  saveChatPreset: (id: string, overlay: ChatOverlaySettings) => void;
  renameChatPreset: (id: string, name: string) => void;
  setActiveSponsorPreset: (id: string) => void;
  createSponsorPreset: (sourceId?: string | null) => string;
  saveSponsorPreset: (id: string, zones: BlurZone[], enabled: boolean, referencePath: string | null) => void;
  renameSponsorPreset: (id: string, name: string) => void;
}

const now = () => new Date().toISOString();

const defaultChatPreset: ChatRenderPreset = {
  id: "chat-default",
  name: "Twitch Chat Default",
  overlay: defaultChatOverlaySettings,
  updatedAt: now(),
};

const defaultSponsorPreset: SponsorBlurPreset = {
  id: "sponsor-default",
  name: "Default Blur",
  zones: [],
  enabled: false,
  referencePath: null,
  updatedAt: now(),
};

export const useWorkflowPresets = create<WorkflowPresetsState>()(
  persist(
    (set, get) => ({
      activeM3u8PresetId: null,
      m3u8Presets: [],
      activeChatPresetId: defaultChatPreset.id,
      chatPresets: [defaultChatPreset],
      activeSponsorPresetId: defaultSponsorPreset.id,
      sponsorPresets: [defaultSponsorPreset],
      setActiveM3u8Preset: (id) => set({ activeM3u8PresetId: id }),
      createM3u8Preset: (sourceId) => {
        const state = get();
        const source = state.m3u8Presets.find((preset) => preset.id === sourceId);
        const id = `m3u8-${Date.now()}`;
        const preset: M3U8StreamerPreset = {
          id,
          name: source ? `${source.name} Copy` : `M3U8 preset ${state.m3u8Presets.length + 1}`,
          streamer: source?.streamer ?? "",
          history: source ? [...source.history] : [],
          updatedAt: now(),
        };
        set((current) => ({
          activeM3u8PresetId: id,
          m3u8Presets: [...current.m3u8Presets, preset],
        }));
        return id;
      },
      renameM3u8Preset: (id, name) =>
        set((state) => ({
          m3u8Presets: state.m3u8Presets.map((preset) =>
            preset.id === id ? { ...preset, name, updatedAt: now() } : preset,
          ),
        })),
      updateM3u8Preset: (id, patch) =>
        set((state) => ({
          m3u8Presets: state.m3u8Presets.map((preset) =>
            preset.id === id ? { ...preset, ...patch, updatedAt: now() } : preset,
          ),
        })),
      rememberM3u8Streamer: (id, streamer) =>
        set((state) => ({
          m3u8Presets: state.m3u8Presets.map((preset) => {
            if (preset.id !== id) return preset;
            const normalized = streamer.trim().replace(/^@/, "");
            const history = [normalized, ...preset.history.filter((item) => item !== normalized)].filter(Boolean).slice(0, 12);
            return { ...preset, streamer: normalized, history, updatedAt: now() };
          }),
        })),
      setActiveChatPreset: (id) => set({ activeChatPresetId: id }),
      createChatPreset: (sourceId) => {
        const state = get();
        const source = state.chatPresets.find((preset) => preset.id === sourceId) ?? state.chatPresets[0] ?? defaultChatPreset;
        const id = `chat-${Date.now()}`;
        const preset: ChatRenderPreset = {
          id,
          name: `${source.name} Copy`,
          overlay: { ...defaultChatOverlaySettings, ...source.overlay },
          updatedAt: now(),
        };
        set((current) => ({
          activeChatPresetId: id,
          chatPresets: [...current.chatPresets, preset],
        }));
        return id;
      },
      saveChatPreset: (id, overlay) =>
        set((state) => ({
          chatPresets: state.chatPresets.map((preset) =>
            preset.id === id ? { ...preset, overlay: { ...defaultChatOverlaySettings, ...overlay }, updatedAt: now() } : preset,
          ),
        })),
      renameChatPreset: (id, name) =>
        set((state) => ({
          chatPresets: state.chatPresets.map((preset) =>
            preset.id === id ? { ...preset, name, updatedAt: now() } : preset,
          ),
        })),
      setActiveSponsorPreset: (id) => set({ activeSponsorPresetId: id }),
      createSponsorPreset: (sourceId) => {
        const state = get();
        const source = state.sponsorPresets.find((preset) => preset.id === sourceId) ?? state.sponsorPresets[0] ?? defaultSponsorPreset;
        const id = `sponsor-${Date.now()}`;
        const preset: SponsorBlurPreset = {
          id,
          name: `${source.name} Copy`,
          zones: source.zones.map((zone) => ({ ...zone })),
          enabled: source.enabled,
          referencePath: source.referencePath,
          updatedAt: now(),
        };
        set((current) => ({
          activeSponsorPresetId: id,
          sponsorPresets: [...current.sponsorPresets, preset],
        }));
        return id;
      },
      saveSponsorPreset: (id, zones, enabled, referencePath) =>
        set((state) => ({
          sponsorPresets: state.sponsorPresets.map((preset) =>
            preset.id === id
              ? {
                  ...preset,
                  zones: zones.map((zone) => ({ ...zone })),
                  enabled,
                  referencePath,
                  updatedAt: now(),
                }
              : preset,
          ),
        })),
      renameSponsorPreset: (id, name) =>
        set((state) => ({
          sponsorPresets: state.sponsorPresets.map((preset) =>
            preset.id === id ? { ...preset, name, updatedAt: now() } : preset,
          ),
        })),
    }),
    {
      name: "fetchr-workflow-presets",
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<WorkflowPresetsState>;
        return {
          ...state,
          activeM3u8PresetId: state.activeM3u8PresetId ?? null,
          m3u8Presets: state.m3u8Presets ?? [],
          activeChatPresetId: state.activeChatPresetId ?? defaultChatPreset.id,
          chatPresets: state.chatPresets?.length ? state.chatPresets : [defaultChatPreset],
          activeSponsorPresetId: state.activeSponsorPresetId ?? defaultSponsorPreset.id,
          sponsorPresets: state.sponsorPresets?.length ? state.sponsorPresets : [defaultSponsorPreset],
        };
      },
    },
  ),
);
