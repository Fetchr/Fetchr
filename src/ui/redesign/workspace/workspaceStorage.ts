import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createDefaultWorkspaceLayout, defaultWorkspaceLayouts } from "./defaultWorkspaces";
import type { WorkspaceLayout, WorkspacePanel } from "./workspaceTypes";

const now = () => new Date().toISOString();

interface WorkspaceLayoutsState {
  activeWorkspaceId: string;
  layouts: Record<string, WorkspaceLayout>;
  setActiveWorkspace: (workspaceId: string) => void;
  loadWorkspaceLayout: (workspaceId: string) => WorkspaceLayout;
  saveWorkspaceLayout: (layout: WorkspaceLayout) => void;
  resetWorkspaceToSaved: (workspaceId: string) => WorkspaceLayout;
  resetWorkspaceToDefault: (workspaceId: string) => WorkspaceLayout;
  duplicateWorkspace: (workspaceId: string, name?: string) => WorkspaceLayout;
  renameWorkspace: (workspaceId: string, name: string) => void;
  deleteWorkspace: (workspaceId: string) => void;
}

export const useWorkspaceLayouts = create<WorkspaceLayoutsState>()(
  persist(
    (set, get) => ({
      activeWorkspaceId: "fast",
      layouts: defaultWorkspaceLayouts,
      setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
      loadWorkspaceLayout: (workspaceId) => resolveWorkspaceLayout(get().layouts, workspaceId),
      saveWorkspaceLayout: (layout) =>
        set((state) => ({
          layouts: {
            ...state.layouts,
            [layout.id]: normalizeWorkspaceLayout({ ...layout, mode: "view", updatedAt: now() }),
          },
        })),
      resetWorkspaceToSaved: (workspaceId) => resolveWorkspaceLayout(get().layouts, workspaceId),
      resetWorkspaceToDefault: (workspaceId) => {
        const current = get().layouts[workspaceId];
        const next = createDefaultWorkspaceLayout(workspaceId, current?.name);
        set((state) => ({
          layouts: {
            ...state.layouts,
            [workspaceId]: next,
          },
        }));
        return next;
      },
      duplicateWorkspace: (workspaceId, name) => {
        const source = resolveWorkspaceLayout(get().layouts, workspaceId);
        const id = `workspace-${Date.now()}`;
        const next: WorkspaceLayout = normalizeWorkspaceLayout({
          ...source,
          id,
          name: name ?? `${source.name} Copy`,
          presetId: source.presetId,
          updatedAt: now(),
          panels: source.panels.map((panel) => ({
            ...panel,
            id: `${id}-${panel.type}-${panel.x}-${panel.y}`,
            props: { ...panel.props },
          })),
          tabGroups: source.tabGroups.map((group) => ({
            ...group,
            id: `${id}-${group.id}`,
            panelIds: [...group.panelIds],
          })),
          floatingPanels: source.floatingPanels.map((panel) => ({ ...panel, id: `${id}-${panel.id}` })),
        });
        set((state) => ({
          activeWorkspaceId: id,
          layouts: {
            ...state.layouts,
            [id]: next,
          },
        }));
        return next;
      },
      renameWorkspace: (workspaceId, name) =>
        set((state) => {
          const layout = resolveWorkspaceLayout(state.layouts, workspaceId);
          return {
            layouts: {
              ...state.layouts,
              [workspaceId]: normalizeWorkspaceLayout({ ...layout, name, updatedAt: now() }),
            },
          };
        }),
      deleteWorkspace: (workspaceId) =>
        set((state) => {
          if (workspaceId in defaultWorkspaceLayouts) return state;
          const { [workspaceId]: _deleted, ...layouts } = state.layouts;
          return {
            layouts,
            activeWorkspaceId: state.activeWorkspaceId === workspaceId ? "fast" : state.activeWorkspaceId,
          };
        }),
    }),
    {
      name: "fetchr-workspace-layouts",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<WorkspaceLayoutsState> & {
          layouts?: Record<string, WorkspaceLayout | LegacyWorkspaceLayout>;
        };
        return {
          ...state,
          activeWorkspaceId: state.activeWorkspaceId ?? "fast",
          layouts: {
            ...defaultWorkspaceLayouts,
            ...Object.fromEntries(
              Object.entries(state.layouts ?? {}).map(([id, layout]) => [id, normalizeWorkspaceLayout(fromLegacyLayout(id, layout))]),
            ),
          },
        };
      },
    },
  ),
);

export function resolveWorkspaceLayout(layouts: Record<string, WorkspaceLayout>, workspaceId: string): WorkspaceLayout {
  return normalizeWorkspaceLayout(layouts[workspaceId] ?? createDefaultWorkspaceLayout(workspaceId));
}

export function normalizeWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    id: layout.id,
    name: layout.name || layout.id,
    presetId: layout.presetId ?? null,
    mode: layout.mode === "edit" ? "edit" : "view",
    version: 1,
    updatedAt: layout.updatedAt || now(),
    panels: (layout.panels ?? []).map(normalizePanel),
    tabGroups: (layout.tabGroups ?? []).map((group) => ({
      ...group,
      panelIds: [...group.panelIds],
    })),
    floatingPanels: (layout.floatingPanels ?? []).map((panel) => ({ ...panel })),
  };
}

function normalizePanel(panel: WorkspacePanel): WorkspacePanel {
  const minW = clamp(panel.minW || 2, 1, 12);
  const minH = clamp(panel.minH || 2, 1, 20);
  const w = clamp(panel.w, minW, panel.maxW ?? 12);
  const h = clamp(panel.h, minH, panel.maxH ?? 20);
  return {
    ...panel,
    x: clamp(panel.x, 0, 12 - w),
    y: clamp(panel.y, 0, 80),
    w,
    h,
    minW,
    minH,
    visible: panel.visible !== false,
    locked: Boolean(panel.locked),
    docked: panel.docked !== false,
    props: panel.props ?? {},
  };
}

interface LegacyWorkspaceLayout {
  workspaceId?: string;
  name?: string;
  blocks?: Array<WorkspacePanel & { category?: string }>;
  updatedAt?: string;
}

function fromLegacyLayout(id: string, layout: WorkspaceLayout | LegacyWorkspaceLayout): WorkspaceLayout {
  if ("panels" in layout) return layout;
  const legacy = layout as LegacyWorkspaceLayout;
  return {
    id: legacy.workspaceId ?? id,
    name: legacy.name ?? id,
    presetId: id in defaultWorkspaceLayouts ? id : null,
    mode: "view",
    version: 1,
    updatedAt: legacy.updatedAt ?? now(),
    tabGroups: [],
    floatingPanels: [],
    panels: (legacy.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      minW: block.minW,
      minH: block.minH,
      visible: block.visible,
      locked: false,
      docked: true,
      props: block.props ?? {},
    })),
  };
}

function clamp(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, normalized));
}
