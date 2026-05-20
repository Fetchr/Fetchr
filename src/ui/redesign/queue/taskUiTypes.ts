import type { JobStatus } from "@/types/job";

export type QueueFilter = "all" | "active" | "queued" | "done" | "error";

export interface QueueTaskUi {
  id: string;
  title: string;
  subtitle: string;
  sourceUrl: string;
  sourceLabel: string;
  platform: string;
  presetName: string;
  status: JobStatus;
  statusLabel: string;
  statusDetail: string;
  speed: string;
  speedBps: number | null;
  eta: string;
  size: string;
  downloadedLabel: string;
  totalLabel: string;
  currentSegment?: string | null;
  stagePercent?: number | null;
  stageRange?: string | null;
  stageElapsed?: string | null;
  progressMessage?: string | null;
  lastLogLine?: string | null;
  queuePosition?: number | null;
  progress: number;
  addedLabel: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
  live: boolean;
  chatOnly: boolean;
  outputPath?: string | null;
  directory: string;
  error?: string | null;
}

export interface QueueCounts {
  all: number;
  active: number;
  queued: number;
  done: number;
  error: number;
}

export interface QueueSummary {
  taskCount: number;
  activeDownloads: number;
  speed: string;
  threads: string;
}

export interface QueueTaskActions {
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRemove?: (id: string) => void;
  onOpenFolder?: (directory: string) => void;
  onRevealFile?: (path: string) => void;
}

export interface PipelineStepUi {
  id: string;
  title: string;
  description: string;
}
