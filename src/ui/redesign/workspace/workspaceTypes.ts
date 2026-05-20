import type { ComponentType } from "react";
import type { RedesignIconName } from "@/ui/redesign/icons/iconMap";

export type WorkspaceMode = "view" | "edit";

export type WorkspacePanelType =
  | "queue_table"
  | "task_details"
  | "preset_inspector"
  | "add_task"
  | "system_status"
  | "logs"
  | "m3u8_public_search"
  | "m3u8_recovered_results"
  | "chat_preview"
  | "chat_export"
  | "sponsor_blur_preview"
  | "sponsor_zone_list"
  | "settings_summary";

export type WorkspacePanelCategory =
  | "sources"
  | "queue"
  | "processing"
  | "chat"
  | "blur"
  | "diagnostics"
  | "settings";

export interface WorkspacePanel {
  id: string;
  type: WorkspacePanelType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
  maxW?: number;
  maxH?: number;
  visible: boolean;
  locked: boolean;
  docked: boolean;
  tabGroupId?: string;
  props: Record<string, unknown>;
}

export interface WorkspaceTabGroup {
  id: string;
  title: string;
  panelIds: string[];
  activePanelId: string;
}

export interface WorkspaceFloatingPanel {
  id: string;
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  presetId: string | null;
  mode: WorkspaceMode;
  version: 1;
  panels: WorkspacePanel[];
  tabGroups: WorkspaceTabGroup[];
  floatingPanels: WorkspaceFloatingPanel[];
  updatedAt: string;
}

export type WorkspaceRenderMode = "view" | "edit" | "preview";

export interface WorkspacePanelRenderProps {
  panel: WorkspacePanel;
  mode: WorkspaceRenderMode;
}

export interface WorkspacePanelDefinition {
  type: WorkspacePanelType;
  title: string;
  description: string;
  category: WorkspacePanelCategory;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  icon: RedesignIconName;
  Component: ComponentType<WorkspacePanelRenderProps>;
  defaultProps: Record<string, unknown>;
  resizable: boolean;
  removable: boolean;
  duplicatable: boolean;
}
