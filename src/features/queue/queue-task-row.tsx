import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderOpen,
  MoreVertical,
  Play,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SourceThumbnail } from "@/components/source-thumbnail";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { formatDuration } from "@/lib/format";
import { platformLabel, type Platform } from "@/lib/url";
import { useSettings } from "@/stores/settings";
import type { Job, JobStatus } from "@/types/job";

interface QueueTaskRowProps {
  job: Job;
  presetName: string;
}

const statusText: Record<JobStatus, string> = {
  queued: "В очереди",
  running: "Скачивается",
  paused: "Пауза",
  done: "Завершено",
  error: "Ошибка",
  cancelled: "Отменено",
};

export function QueueTaskRow({ job, presetName }: QueueTaskRowProps) {
  const [now, setNow] = useState(Date.now());
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);
  const isRunning = job.status === "running";
  const isLive = job.spec.mode === "live" && isRunning;
  const isChatOnly = job.spec.job_kind === "chat";
  const meta = job.spec.meta;
  const platform = (meta?.platform || "unknown") as Platform;
  const percent = Math.max(0, Math.min(100, job.status === "done" ? 100 : job.progress.percent));
  const title = job.spec.start && job.spec.end ? job.spec.name : meta?.title || job.spec.name;
  const subtitle = meta?.uploader ?? (job.spec.mode === "live" ? "Live stream" : "VOD");
  const createdLabel = formatCreated(job.created_at);

  const elapsedMs = useMemo(() => {
    if (!job.started_at) return 0;
    const end = job.finished_at ?? now;
    return Math.max(0, end - job.started_at);
  }, [job.finished_at, job.started_at, now]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const remove = () => void ipc.removeJob(job.id);
  const cancel = () => void ipc.cancelJob(job.id);
  const openFolder = () => void ipc.openFolder(job.spec.directory);
  const revealFile = () => {
    const path = job.output_path || meta?.output_path;
    if (path) void ipc.revealFile(path);
  };

  return (
    <div
      className={cn(
        "grid min-h-[78px] grid-cols-[minmax(260px,1.8fr)_minmax(170px,1fr)_116px_150px_118px_94px_minmax(150px,1fr)_96px] items-center gap-4 border-b border-border-subtle px-4 text-[12px] last:border-b-0",
        isRunning && "bg-accent/10 shadow-[inset_2px_0_0_hsl(var(--accent))]",
        !isRunning && "hover:bg-elevated/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SourceThumbnail
          thumbnail={meta?.thumbnail}
          platform={platform}
          title={title}
          duration={meta?.duration}
          live={isLive}
          chatOnly={isChatOnly}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg-primary" title={title}>
            {isChatOnly ? "Чат: " : job.spec.mode === "live" ? "Стрим: " : "VOD: "}
            {title}
          </div>
          <div className="mt-1 truncate text-[11px] text-fg-tertiary" title={subtitle}>
            {subtitle}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-fg-secondary">
          <span className={cn("h-2 w-2 rounded-sm", platformColor(platform))} />
          <span className="truncate">{platformLabel(platform)}</span>
        </div>
        <div className="mt-1 truncate font-mono text-[10.5px] text-fg-tertiary" title={job.spec.url}>
          {job.spec.url}
        </div>
      </div>

      <div className="truncate text-fg-secondary" title={presetName}>
        {presetName}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} live={isLive} />
          <span className={cn("truncate", job.status === "error" ? "text-danger" : "text-fg-secondary")}>
            {statusText[job.status]}
          </span>
        </div>
        <div className="mt-1 truncate text-[10.5px] text-fg-tertiary" title={job.error ?? job.progress.message ?? ""}>
          {job.error ?? job.progress.message ?? (job.status === "queued" ? "Ожидает свободного потока" : "")}
        </div>
      </div>

      <Metric value={job.progress.speed ?? (isRunning ? "..." : "-")} />
      <Metric
        value={
          job.progress.eta ??
          (isRunning && elapsedMs ? formatDuration(elapsedMs / 1000) : job.status === "queued" ? "В очереди" : "-")
        }
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-elevated">
            <div
              className={cn(
                "h-full transition-[width] duration-200",
                job.status === "done" && "bg-success",
                job.status === "error" && "bg-danger",
                job.status !== "done" && job.status !== "error" && "bg-accent",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-9 text-right font-mono text-[11px] text-fg-secondary tabular">
            {Math.round(percent)}%
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 truncate text-[10.5px] text-fg-tertiary">
          <Clock3 className="h-3 w-3 shrink-0" />
          <span className="truncate">{createdLabel}</span>
        </div>
      </div>

      <div className="flex justify-end gap-0.5">
        {job.status === "queued" && (
          <>
            <IconButton title="Выше" onClick={() => void ipc.moveJob(job.id, "up")}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title="Ниже" onClick={() => void ipc.moveJob(job.id, "down")}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
        {job.status === "paused" && (
          <IconButton title="Продолжить" onClick={() => void ipc.startQueue(maxConcurrentJobs)}>
            <Play className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {isRunning && (
          <IconButton title="Отменить" onClick={cancel}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {job.status === "done" && (job.output_path || meta?.output_path) && (
          <IconButton title="Показать файл" onClick={revealFile}>
            <CheckCircle2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <IconButton title="Открыть папку" onClick={openFolder}>
          <FolderOpen className="h-3.5 w-3.5" />
        </IconButton>
        {!isRunning && (
          <IconButton title="Удалить" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <IconButton title="Детали" onClick={() => undefined}>
          {job.status === "error" ? <MoreVertical className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </IconButton>
      </div>
    </div>
  );
}

function Metric({ value }: { value: string }) {
  return (
    <div className="truncate font-mono text-[11px] text-fg-secondary tabular" title={value}>
      {value}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button size="icon-sm" variant="ghost" title={title} onClick={onClick}>
      {children}
    </Button>
  );
}

function platformColor(platform: Platform) {
  switch (platform) {
    case "twitch":
      return "bg-[#8b5cf6]";
    case "kick":
      return "bg-[#37d353]";
    case "youtube":
      return "bg-[#ef4444]";
    case "hls":
      return "bg-accent";
    default:
      return "bg-fg-tertiary";
  }
}

function formatCreated(timestamp: number) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "-";
  }
}
