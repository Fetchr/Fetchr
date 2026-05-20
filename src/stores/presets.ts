import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PresetFeatureId =
  | "resolve"
  | "preview"
  | "quality"
  | "clips"
  | "split"
  | "chat"
  | "sponsorBlur"
  | "proxy"
  | "performance"
  | "logs";

export interface PresetFeature {
  id: PresetFeatureId;
  title: string;
  description: string;
  group: "source" | "processing" | "output";
}

export interface PresetRuntimeSettings {
  directory: string | null;
  downloadKind: "video" | "audio";
  quality: string;
  isLive: boolean;
  split: boolean;
  splitMinutes: number;
  downloadChat: boolean;
  blurSponsors: boolean;
  unmuteVideo: boolean;
  useProxy: boolean;
  proxyUrl: string;
}

export interface PresetFeatureLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  gap: number;
  compact: boolean;
}

export interface FetchrPreset {
  id: string;
  name: string;
  description: string;
  features: PresetFeatureId[];
  runtime: PresetRuntimeSettings;
  layout: Record<PresetFeatureId, PresetFeatureLayout>;
  updatedAt: string;
}

export const presetFeatureCatalog: PresetFeature[] = [
  {
    id: "resolve",
    title: "Распознавание ссылки",
    description: "Определяет платформу, длительность, название и доступные потоки.",
    group: "source",
  },
  {
    id: "preview",
    title: "Предпросмотр",
    description: "Показывает плеер перед постановкой задачи в очередь.",
    group: "source",
  },
  {
    id: "quality",
    title: "Выбор качества",
    description: "Дает пользователю ручной выбор видео, аудио и контейнера.",
    group: "source",
  },
  {
    id: "clips",
    title: "Таймкоды и клипы",
    description: "Позволяет собирать один диапазон или список фрагментов.",
    group: "processing",
  },
  {
    id: "split",
    title: "Нарезка файла",
    description: "Разделяет итоговый файл на части по выбранной длине.",
    group: "processing",
  },
  {
    id: "chat",
    title: "Рендер чата",
    description: "Скачивает replay-чат и встраивает его в итоговое видео.",
    group: "output",
  },
  {
    id: "sponsorBlur",
    title: "Блюр спонсоров",
    description: "Применяет сохраненные зоны блюра или изображений поверх видео.",
    group: "processing",
  },
  {
    id: "proxy",
    title: "Прокси",
    description: "Добавляет ручную сетевую прокладку для недоступных источников.",
    group: "source",
  },
  {
    id: "performance",
    title: "Производительность",
    description: "Включает ручную настройку потоков, GPU-кодера и профиля FFmpeg.",
    group: "processing",
  },
  {
    id: "logs",
    title: "Детальные логи",
    description: "Оставляет диагностику рядом с задачей для проверки результата.",
    group: "output",
  },
];

const now = () => new Date().toISOString();

export const defaultPresetRuntimeSettings: PresetRuntimeSettings = {
  directory: null,
  downloadKind: "video",
  quality: "best",
  isLive: false,
  split: false,
  splitMinutes: 1,
  downloadChat: false,
  blurSponsors: false,
  unmuteVideo: false,
  useProxy: false,
  proxyUrl: "http://127.0.0.1:2080",
};

export const defaultPresetFeatureLayout: Record<PresetFeatureId, PresetFeatureLayout> = {
  resolve: { x: 1, y: 1, w: 12, h: 2, gap: 12, compact: false },
  preview: { x: 8, y: 3, w: 5, h: 7, gap: 12, compact: false },
  quality: { x: 1, y: 3, w: 7, h: 2, gap: 12, compact: false },
  clips: { x: 1, y: 5, w: 7, h: 6, gap: 12, compact: false },
  split: { x: 1, y: 11, w: 7, h: 2, gap: 12, compact: true },
  chat: { x: 8, y: 10, w: 5, h: 3, gap: 12, compact: false },
  sponsorBlur: { x: 8, y: 13, w: 5, h: 3, gap: 12, compact: false },
  proxy: { x: 1, y: 13, w: 7, h: 2, gap: 12, compact: true },
  performance: { x: 1, y: 15, w: 7, h: 2, gap: 12, compact: true },
  logs: { x: 8, y: 16, w: 5, h: 2, gap: 12, compact: true },
};

const defaultPresets: FetchrPreset[] = [
  {
    id: "creator",
    name: "Creator",
    description: "Видео, чат, клипы и чистый контроль результата.",
    features: ["resolve", "preview", "quality", "clips", "chat", "performance", "logs"],
    runtime: { ...defaultPresetRuntimeSettings, downloadChat: true },
    layout: defaultPresetFeatureLayout,
    updatedAt: now(),
  },
  {
    id: "fast",
    name: "Fast Save",
    description: "Минимальный пресет для быстрой загрузки без лишних шагов.",
    features: ["resolve", "quality", "split", "logs"],
    runtime: { ...defaultPresetRuntimeSettings, split: true, splitMinutes: 15 },
    layout: {
      ...defaultPresetFeatureLayout,
      resolve: { x: 1, y: 1, w: 12, h: 2, gap: 10, compact: true },
      quality: { x: 1, y: 3, w: 6, h: 2, gap: 10, compact: true },
      split: { x: 7, y: 3, w: 6, h: 2, gap: 10, compact: true },
      logs: { x: 1, y: 5, w: 12, h: 2, gap: 10, compact: true },
    },
    updatedAt: now(),
  },
  {
    id: "clean",
    name: "Clean Edit",
    description: "Фокус на клипах, блюре и аккуратной подготовке видео.",
    features: ["resolve", "preview", "clips", "sponsorBlur", "performance", "logs"],
    runtime: { ...defaultPresetRuntimeSettings, blurSponsors: true },
    layout: {
      ...defaultPresetFeatureLayout,
      preview: { x: 1, y: 3, w: 6, h: 6, gap: 12, compact: false },
      clips: { x: 7, y: 3, w: 6, h: 6, gap: 12, compact: false },
      sponsorBlur: { x: 1, y: 9, w: 6, h: 3, gap: 12, compact: false },
      performance: { x: 7, y: 9, w: 6, h: 3, gap: 12, compact: true },
    },
    updatedAt: now(),
  },
];

interface PresetsState {
  activePresetId: string;
  presets: FetchrPreset[];
  setActivePreset: (id: string) => void;
  createPreset: () => void;
  duplicatePreset: (id: string) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<Pick<FetchrPreset, "name" | "description">>) => void;
  updatePresetRuntime: (id: string, patch: Partial<PresetRuntimeSettings>) => void;
  updateFeatureLayout: (
    presetId: string,
    featureId: PresetFeatureId,
    patch: Partial<PresetFeatureLayout>,
  ) => void;
  toggleFeature: (presetId: string, featureId: PresetFeatureId) => void;
  clearPreset: (id: string) => void;
}

export const usePresets = create<PresetsState>()(
  persist(
    (set) => ({
      activePresetId: defaultPresets[0].id,
      presets: defaultPresets,
      setActivePreset: (id) => set({ activePresetId: id }),
      createPreset: () =>
        set((state) => {
          const id = `preset-${Date.now()}`;
          return {
            activePresetId: id,
            presets: [
              ...state.presets,
              {
                id,
                name: `Preset ${state.presets.length + 1}`,
                description: "Ручной пресет под индивидуальный сценарий.",
                features: ["resolve", "preview", "quality"],
                runtime: { ...defaultPresetRuntimeSettings },
                layout: { ...defaultPresetFeatureLayout },
                updatedAt: now(),
              },
            ],
          };
        }),
      duplicatePreset: (id) =>
        set((state) => {
          const source = state.presets.find((preset) => preset.id === id) ?? state.presets[0];
          const nextId = `preset-${Date.now()}`;
          return {
            activePresetId: nextId,
            presets: [
              ...state.presets,
              {
                ...source,
                id: nextId,
                name: `${source.name} Copy`,
                features: [...source.features],
                runtime: { ...source.runtime },
                layout: { ...source.layout },
                updatedAt: now(),
              },
            ],
          };
        }),
      removePreset: (id) =>
        set((state) => {
          if (state.presets.length <= 1) return state;
          const presets = state.presets.filter((preset) => preset.id !== id);
          return {
            presets,
            activePresetId: state.activePresetId === id ? presets[0].id : state.activePresetId,
          };
        }),
      updatePreset: (id, patch) =>
        set((state) => ({
          presets: state.presets.map((preset) =>
            preset.id === id ? { ...preset, ...patch, updatedAt: now() } : preset,
          ),
        })),
      updatePresetRuntime: (id, patch) =>
        set((state) => ({
          presets: state.presets.map((preset) =>
            preset.id === id
              ? {
                  ...preset,
                  runtime: {
                    ...defaultPresetRuntimeSettings,
                    ...preset.runtime,
                    ...patch,
                  },
                  updatedAt: now(),
                }
              : preset,
          ),
        })),
      updateFeatureLayout: (presetId, featureId, patch) =>
        set((state) => ({
          presets: state.presets.map((preset) => {
            if (preset.id !== presetId) return preset;
            const current = preset.layout?.[featureId] ?? defaultPresetFeatureLayout[featureId];
            const next = {
              ...current,
              ...patch,
              x: Math.max(1, Math.min(12, Math.floor(patch.x ?? current.x))),
              y: Math.max(1, Math.min(40, Math.floor(patch.y ?? current.y))),
              w: Math.max(1, Math.min(12, Math.floor(patch.w ?? current.w))),
              h: Math.max(1, Math.min(12, Math.floor(patch.h ?? current.h))),
              gap: Math.max(0, Math.min(32, Math.floor(patch.gap ?? current.gap))),
            };
            if (next.x + next.w > 13) {
              next.x = 13 - next.w;
            }
            return {
              ...preset,
              layout: {
                ...defaultPresetFeatureLayout,
                ...preset.layout,
                [featureId]: next,
              },
              updatedAt: now(),
            };
          }),
        })),
      toggleFeature: (presetId, featureId) =>
        set((state) => ({
          presets: state.presets.map((preset) => {
            if (preset.id !== presetId) return preset;
            const enabled = preset.features.includes(featureId);
            return {
              ...preset,
              features: enabled
                ? preset.features.filter((id) => id !== featureId)
                : [...preset.features, featureId],
              updatedAt: now(),
            };
          }),
        })),
      clearPreset: (id) =>
        set((state) => ({
          presets: state.presets.map((preset) =>
            preset.id === id ? { ...preset, features: [], updatedAt: now() } : preset,
          ),
        })),
    }),
    {
      name: "fetchr-preset-builder",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<PresetsState>;
        return {
          ...state,
          presets: (state.presets ?? defaultPresets).map((preset) => ({
            ...preset,
            runtime: {
              ...defaultPresetRuntimeSettings,
              ...preset.runtime,
            },
            layout: {
              ...defaultPresetFeatureLayout,
              ...preset.layout,
            },
          })),
        };
      },
    },
  ),
);
