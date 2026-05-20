import { useMemo, useState } from "react";

import { ipc } from "@/lib/ipc";
import { useLogs } from "@/stores/logs";
import { usePresets } from "@/stores/presets";
import { useQueue } from "@/stores/queue";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import type { Job, JobStatus } from "@/types/job";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./QueuePage.module.css";
import { QueueHeader } from "./QueueHeader";
import { TaskTable } from "./TaskTable";
import type { QueueCounts, QueueFilter, QueueSummary, QueueTaskActions, QueueTaskUi } from "./taskUiTypes";

export function QueuePage() {
  const jobs = useQueue((state) => state.jobs);
  const logLines = useLogs((state) => state.lines);
  const openAddDialog = useUI((state) => state.openAddDialog);
  const maxConcurrentJobs = useSettings((state) => state.maxConcurrentJobs);
  const presets = usePresets((state) => state.presets);
  const activePresetId = usePresets((state) => state.activePresetId);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const presetName = activePreset?.name ?? "Fast Save";
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [autoscroll, setAutoscroll] = useState(true);

  const allTasks = useMemo(
    () => {
      const latestLogs = latestLogByJob(logLines);
      return jobs.map((job, index) =>
        adaptJobToTask(job, presetName, getQueuePosition(jobs, index), latestLogs.get(job.id) ?? null),
      );
    },
    [jobs, presetName, logLines],
  );
  const counts = useMemo(() => getQueueCounts(allTasks), [allTasks]);
  const filteredTasks = useMemo(() => filterTasks(allTasks, activeFilter), [activeFilter, allTasks]);
  const running = counts.active > 0;
  const summary = useMemo(() => getQueueSummary(allTasks, maxConcurrentJobs), [allTasks, maxConcurrentJobs]);

  const actions: QueueTaskActions = {
    onMoveUp: (id) => void ipc.moveJob(id, "up"),
    onMoveDown: (id) => void ipc.moveJob(id, "down"),
    onCancel: (id) => void ipc.cancelJob(id),
    onRemove: (id) => void ipc.removeJob(id),
    onOpenFolder: (path) => void ipc.openFolder(path),
    onRevealFile: (path) => void ipc.revealFile(path),
  };

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <QueueHeader
        activeFilter={activeFilter}
        counts={counts}
        running={running}
        canStart={counts.queued > 0}
        onFilterChange={setActiveFilter}
        onAddTask={openAddDialog}
        onStartQueue={() => void ipc.startQueue(maxConcurrentJobs)}
        onPauseQueue={() => void ipc.pauseQueue()}
        onClearCompleted={() => void ipc.clearCompleted()}
      />

      <div className={styles.tableArea}>
        <TaskTable
          tasks={filteredTasks}
          summary={summary}
          autoscroll={autoscroll}
          onAutoscrollChange={setAutoscroll}
          actions={actions}
        />
      </div>
    </div>
  );
}

function adaptJobToTask(job: Job, presetName: string, queuePosition: number | null, lastLogLine: string | null): QueueTaskUi {
  const meta = job.spec.meta;
  const platform = meta?.platform || "unknown";
  const percent = job.status === "done" ? 100 : job.progress.percent;
  const progress = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const live = job.spec.mode === "live";
  const chatOnly = job.spec.job_kind === "chat";
  const rawTitle = meta?.title || job.spec.name || job.spec.url;
  const title = `${getTaskPrefix(job)} ${rawTitle}`;
  const statusLabel = getStatusLabel(job.status);
  const totalBytes = job.progress.total_bytes ?? parseSizeToBytes(job.progress.size);
  const downloadedBytes =
    job.progress.downloaded_bytes ??
    (job.status === "done" && totalBytes != null ? totalBytes : totalBytes != null ? Math.round((totalBytes * progress) / 100) : null);
  const speedBps = job.progress.speed_bps ?? parseSpeedToBps(job.progress.speed);
  const currentSegment = job.progress.current_segment ?? extractCurrentSegment(job.progress.message);
  const stagePercent = job.progress.stage_percent ?? null;
  const stageRange =
    job.progress.stage_start != null && job.progress.stage_end != null
      ? `${job.progress.stage_start.toFixed(0)}-${job.progress.stage_end.toFixed(0)}%`
      : null;
  const stageElapsed =
    job.progress.stage_started_at != null
      ? formatDurationLabel(Math.max(0, Date.now() - job.progress.stage_started_at))
      : null;
  const totalLabel = totalBytes != null ? formatBytes(totalBytes) : job.progress.size || "—";
  const downloadedLabel = downloadedBytes != null ? formatBytes(downloadedBytes) : "—";
  const sizeLabel =
    job.status === "running" && totalBytes != null
      ? `${downloadedLabel} / ${totalLabel}`
      : job.status === "done" && totalBytes != null
        ? totalLabel
        : job.progress.size || "—";

  return {
    id: job.id,
    title,
    subtitle: meta?.uploader || (live ? "Live stream" : chatOnly ? "Chat export" : "VOD"),
    sourceUrl: job.spec.url,
    sourceLabel: getPlatformLabel(platform),
    platform,
    presetName,
    status: job.status,
    statusLabel,
    statusDetail: getStatusDetail(job, queuePosition, currentSegment),
    speed: job.status === "running" ? job.progress.speed || "—" : "—",
    speedBps,
    eta: job.progress.eta || (job.status === "queued" ? "В очереди" : "—"),
    size: sizeLabel,
    downloadedLabel,
    totalLabel,
    currentSegment,
    stagePercent,
    stageRange,
    stageElapsed,
    progressMessage: job.progress.message ?? null,
    lastLogLine,
    queuePosition,
    progress,
    addedLabel: formatAdded(job.created_at),
    thumbnailUrl: meta?.thumbnail ?? null,
    duration: meta?.duration,
    live,
    chatOnly,
    outputPath: job.output_path || meta?.output_path || null,
    directory: job.spec.directory,
    error: job.error,
  };
}

function latestLogByJob(lines: { id: string; line: string }[]) {
  const result = new Map<string, string>();
  for (const line of lines) result.set(line.id, line.line);
  return result;
}

function getQueuePosition(jobs: Job[], index: number): number | null {
  if (jobs[index]?.status !== "queued") return null;
  return jobs.slice(0, index + 1).filter((job) => job.status === "queued").length;
}

function getQueueCounts(tasks: QueueTaskUi[]): QueueCounts {
  return {
    all: tasks.length,
    active: tasks.filter((task) => task.status === "running" || task.status === "paused").length,
    queued: tasks.filter((task) => task.status === "queued").length,
    done: tasks.filter((task) => task.status === "done").length,
    error: tasks.filter((task) => task.status === "error" || task.status === "cancelled").length,
  };
}

function getQueueSummary(tasks: QueueTaskUi[], maxConcurrentJobs: number): QueueSummary {
  const running = tasks.filter((task) => task.status === "running");
  const aggregateSpeedBps = running.reduce((total, task) => total + (task.speedBps ?? 0), 0);

  return {
    taskCount: tasks.length,
    activeDownloads: running.length,
    speed: aggregateSpeedBps > 0 ? `${formatBytes(aggregateSpeedBps)}/s` : "—",
    threads: `${running.length} / ${maxConcurrentJobs}`,
  };
}

function filterTasks(tasks: QueueTaskUi[], filter: QueueFilter): QueueTaskUi[] {
  if (filter === "all") return tasks;
  if (filter === "active") return tasks.filter((task) => task.status === "running" || task.status === "paused");
  if (filter === "queued") return tasks.filter((task) => task.status === "queued");
  if (filter === "done") return tasks.filter((task) => task.status === "done");
  return tasks.filter((task) => task.status === "error" || task.status === "cancelled");
}

function getTaskPrefix(job: Job): string {
  if (job.spec.job_kind === "chat") return "Чат:";
  if (job.spec.mode === "live") return "Стрим:";
  return "VOD:";
}

function getStatusLabel(status: JobStatus): string {
  switch (status) {
    case "running":
      return "Скачивается";
    case "queued":
      return "В очереди";
    case "paused":
      return "Пауза";
    case "done":
      return "Завершено";
    case "cancelled":
      return "Отменено";
    case "error":
      return "Ошибка";
  }
}

function getStatusDetail(job: Job, queuePosition: number | null, currentSegment?: string | null): string {
  if (job.error) return job.error;
  if (currentSegment) return currentSegment;
  if (job.progress.message) return job.progress.message;
  if (job.status === "queued") return queuePosition ? `Позиция в очереди: ${queuePosition}` : "Ожидает свободного потока";
  if (job.status === "done") return "Готово к просмотру";
  if (job.status === "running" && job.progress.stage_percent != null) {
    return `Этап ${Math.round(job.progress.stage_percent)}%`;
  }
  return "";
}

function parseSizeToBytes(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*([KMGT]?i?B|[KMGT]?B)/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * unitMultiplier(match[2]));
}

function parseSpeedToBps(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/ps$/i, "/s");
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*([KMGT]?i?B|[KMGT]?B)\/s/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return amount * unitMultiplier(match[2]);
}

function unitMultiplier(unit: string): number {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("k")) return 1024;
  if (normalized.startsWith("m")) return 1024 ** 2;
  if (normalized.startsWith("g")) return 1024 ** 3;
  if (normalized.startsWith("t")) return 1024 ** 4;
  return 1;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(2)} ${units[unitIndex]}`;
}

function extractCurrentSegment(message?: string | null): string | null {
  if (!message) return null;
  const fragment = message.match(/fragment\s+([^\s]+(?:\s*-\s*[^\s]+)?)/i);
  if (fragment) return `Сегмент: ${fragment[1]}`;
  const step = message.match(/(?:segment|frag(?:ment)?)\D+(\d+\s*\/\s*\d+)/i);
  return step ? `Сегмент: ${step[1].replace(/\s+/g, "")}` : null;
}

function getPlatformLabel(platform: string): string {
  switch (platform.toLowerCase()) {
    case "twitch":
      return "Twitch";
    case "youtube":
      return "YouTube";
    case "kick":
      return "Kick";
    case "hls":
      return "HLS";
    case "rtmp":
      return "RTMP";
    case "vk":
      return "VK";
    default:
      return "Unknown";
  }
}

function formatAdded(timestamp: number): string {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (sameDay) return `Сегодня ${time}`;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDurationLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
