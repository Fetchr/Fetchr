import { createWorkspacePanel } from "./workspaceBlockRegistry";
import type { WorkspaceLayout } from "./workspaceTypes";

const now = () => new Date().toISOString();

export const defaultWorkspaceLayouts: Record<string, WorkspaceLayout> = {
  fast: {
    id: "fast",
    name: "Fast Save",
    presetId: "fast",
    mode: "view",
    version: 1,
    updatedAt: now(),
    tabGroups: [],
    floatingPanels: [],
    panels: [
      createWorkspacePanel("queue_table", { id: "fast-queue", x: 3, y: 0, w: 7, h: 8 }),
      createWorkspacePanel("preset_inspector", { id: "fast-preset", x: 10, y: 0, w: 2, h: 8 }),
      createWorkspacePanel("system_status", { id: "fast-system", x: 0, y: 0, w: 3, h: 4 }),
      createWorkspacePanel("add_task", { id: "fast-add", x: 0, y: 4, w: 3, h: 4 }),
    ],
  },
  creator: {
    id: "creator",
    name: "Creator",
    presetId: "creator",
    mode: "view",
    version: 1,
    updatedAt: now(),
    tabGroups: [],
    floatingPanels: [],
    panels: [
      createWorkspacePanel("queue_table", { id: "creator-queue", x: 0, y: 0, w: 6, h: 6 }),
      createWorkspacePanel("chat_preview", { id: "creator-chat-preview", x: 6, y: 0, w: 4, h: 6 }),
      createWorkspacePanel("chat_export", { id: "creator-chat-export", x: 10, y: 0, w: 2, h: 6 }),
      createWorkspacePanel("sponsor_blur_preview", { id: "creator-blur", x: 0, y: 6, w: 6, h: 5 }),
      createWorkspacePanel("preset_inspector", { id: "creator-preset", x: 6, y: 6, w: 6, h: 5 }),
    ],
  },
  clean: {
    id: "clean",
    name: "Clean Edit",
    presetId: "clean",
    mode: "view",
    version: 1,
    updatedAt: now(),
    tabGroups: [],
    floatingPanels: [],
    panels: [
      createWorkspacePanel("queue_table", { id: "clean-queue", x: 0, y: 0, w: 6, h: 5 }),
      createWorkspacePanel("m3u8_public_search", { id: "clean-m3u8-public", x: 6, y: 0, w: 3, h: 5 }),
      createWorkspacePanel("m3u8_recovered_results", { id: "clean-m3u8-recovered", x: 9, y: 0, w: 3, h: 5 }),
      createWorkspacePanel("logs", { id: "clean-logs", x: 0, y: 5, w: 6, h: 4 }),
      createWorkspacePanel("preset_inspector", { id: "clean-preset", x: 6, y: 5, w: 6, h: 4 }),
    ],
  },
};

export function createDefaultWorkspaceLayout(workspaceId: string, name?: string): WorkspaceLayout {
  const base =
    defaultWorkspaceLayouts[workspaceId] ??
    defaultWorkspaceLayouts[workspaceId.toLowerCase()] ??
    defaultWorkspaceLayouts.fast;

  return {
    ...base,
    id: workspaceId,
    name: name ?? base.name,
    updatedAt: now(),
    tabGroups: base.tabGroups.map((group) => ({ ...group, panelIds: [...group.panelIds] })),
    floatingPanels: base.floatingPanels.map((panel) => ({ ...panel })),
    panels: base.panels.map((panel) => ({
      ...panel,
      id: `${workspaceId}-${panel.type}-${panel.x}-${panel.y}`,
      props: { ...panel.props },
    })),
  };
}
