import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Play,
  Trash2,
  FolderOpen,
  X,
  Radio,
  Film,
  MessageSquareText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { formatDuration } from "@/lib/format";
import { platformLabel, type Platform } from "@/lib/url";
import { useSettings } from "@/stores/settings";
import type { Job } from "@/types/job";

interface DownloadRowProps {
  job: Job;
  selected?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
}

export function DownloadRow({ job, selected, onSelect }: DownloadRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isRunning = job.status === "running";
  const isLive = job.spec.mode === "live" && isRunning;
  const percent = Math.max(0, Math.min(100, job.status === "done" ? 100 : job.progress.percent));
  const isChatOnly = job.spec.job_kind === "chat";
  const showIndeterminate = isRunning && percent <= 0.5;

  const meta = job.spec.meta;
  const title = job.spec.start && job.spec.end ? job.spec.name : meta?.title || job.spec.name;
  const platform = (meta?.platform || "unknown") as Platform;
  const fragmentCount = job.spec.fragments?.length ?? 0;
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);
  const stagePercent = Math.max(0, Math.min(100, job.progress.stage_percent ?? percent));
  const elapsedMs = useMemo(() => {
    if (!job.started_at) return 0;
    const end = job.finished_at ?? now;
    return Math.max(0, end - job.started_at);
  }, [job.finished_at, job.started_at, now]);
  const downloadElapsedMs = job.progress.download_elapsed_ms ?? null;
  const stageElapsedMs = useMemo(() => {
    if (!job.progress.stage_started_at) return elapsedMs;
    const end = job.finished_at ?? now;
    return Math.max(0, end - job.progress.stage_started_at);
  }, [elapsedMs, job.finished_at, job.progress.stage_started_at, now]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const cancel = () => {
    void ipc.cancelJob(job.id);
  };
  const remove = () => {
    void ipc.removeJob(job.id);
  };
  const openFolder = () => {
    void ipc.openFolder(job.spec.directory);
  };
  const revealFile = () => {
    const p = job.output_path || meta?.output_path;
    if (p) void ipc.revealFile(p);
  };
  const move = (direction: "up" | "down") => {
    void ipc.moveJob(job.id, direction);
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 border-b border-border-subtle px-3 py-2.5 transition-colors",
        selected && "bg-overlay",
        !selected && "hover:bg-elevated/60",
      )}
      onClick={(e) => onSelect?.(job.id, e)}
    >
      {/* Thumbnail or platform badge */}
      <div className="relative mt-0.5 h-[54px] w-24 shrink-0 overflow-hidden rounded-sm border border-border-subtle bg-elevated">
        {meta?.thumbnail ? (
          <img
            src={meta.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-fg-tertiary">
            {isChatOnly ? (
              <MessageSquareText className="h-5 w-5" strokeWidth={1.5} />
            ) : job.spec.mode === "live" ? (
              <Radio className="h-5 w-5" strokeWidth={1.5} />
            ) : (
              <Film className="h-5 w-5" strokeWidth={1.5} />
            )}
          </div>
        )}
        {meta?.duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/70 px-1 py-[1px] font-mono text-[9px] tabular text-white/90">
            {formatDuration(meta.duration)}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} live={isLive} />
          <span className="truncate text-[13px] font-medium text-fg-primary">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
          <span className="font-mono uppercase tracking-wider">
            {isChatOnly ? "CHAT" : platformLabel(platform)}
          </span>
          {meta?.uploader && (
            <>
              <span>·</span>
              <span className="truncate">{meta.uploader}</span>
            </>
          )}
          <span>·</span>
          <span className="truncate font-mono text-[10.5px]" title={job.spec.url}>
            {job.spec.url}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-fg-tertiary">
          {job.spec.start && job.spec.end && (
            <span className="font-mono tabular">
              {job.spec.start}-{job.spec.end}
            </span>
          )}
          {fragmentCount > 0 && (
            <span className="font-mono tabular">
              {fragmentCount} fragments
            </span>
          )}
          {job.progress.speed && (
            <span className="font-mono tabular">down {job.progress.speed}</span>
          )}
          {job.progress.eta && (
            <span className="font-mono tabular">ETA {job.progress.eta}</span>
          )}
          {job.progress.size && (
            <span className="font-mono tabular">{job.progress.size}</span>
          )}
          {isRunning && (
            <span className="font-mono tabular">elapsed {formatMs(elapsedMs)}</span>
          )}
          {isRunning && job.progress.stage_started_at && (
            <span className="font-mono tabular">stage {formatMs(stageElapsedMs)}</span>
          )}
          {downloadElapsedMs != null && (
            <span className="font-mono tabular">download {formatMs(downloadElapsedMs)}</span>
          )}
          {job.progress.message && (
            <span className="truncate text-accent" title={job.progress.message}>
              {job.progress.message}
            </span>
          )}
          {job.error && (
            <span className="truncate text-danger" title={job.error}>
              {job.error}
            </span>
          )}
        </div>

        <div
          className="mt-1.5 h-[4px] overflow-hidden rounded-sm bg-elevated"
          title={`${percent.toFixed(0)}%${job.progress.message ? ` - ${job.progress.message}` : ""}`}
        >
          {showIndeterminate ? (
            <div className="h-full w-1/3 animate-pulse rounded-sm bg-accent/80" />
          ) : (
            <div
              className={cn(
                "h-full transition-[width] duration-200",
                job.status === "done" && "bg-success",
                job.status === "error" && "bg-danger",
                job.status === "cancelled" && "bg-fg-tertiary",
                (job.status === "queued" || job.status === "running" || job.status === "paused") &&
                  "bg-accent",
              )}
              style={{ width: `${percent}%` }}
            />
          )}
        </div>

        {expanded && (
          <div className="mt-2 rounded-sm border border-border-subtle bg-panel/60 p-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-tertiary">
              <Detail label="Статус" value={job.status} />
              <Detail label="Время задачи" value={formatMs(elapsedMs)} />
              <Detail label="Время стадии" value={formatMs(stageElapsedMs)} />
              <Detail label="Общий прогресс" value={`${percent.toFixed(1)}%`} />
              <Detail label="Стадия" value={job.progress.message ?? "-"} />
              <Detail
                label="Прогресс стадии"
                value={`${stagePercent.toFixed(1)}% (${(job.progress.stage_start ?? 0).toFixed(0)}-${(job.progress.stage_end ?? 100).toFixed(0)}%)`}
              />
              <Detail
                label="Скачивание"
                value={
                  downloadElapsedMs != null
                    ? formatMs(downloadElapsedMs)
                    : isRunning
                      ? formatMs(elapsedMs)
                      : "-"
                }
              />
              <Detail label="Скорость" value={job.progress.speed ?? "-"} />
              <Detail label="ETA" value={job.progress.eta ?? "-"} />
              <Detail label="Размер" value={job.progress.size ?? "-"} />
              <Detail label="Файл" value={job.output_path || meta?.output_path || "-"} wide />
            </div>
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-fg-tertiary">
                <span>Текущая стадия</span>
                <span className="font-mono tabular">{stagePercent.toFixed(1)}%</span>
              </div>
              <div className="h-[4px] overflow-hidden rounded-sm bg-elevated">
                <div className="h-full bg-accent" style={{ width: `${stagePercent}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex w-48 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((value) => !value);
          }}
          title={expanded ? "Скрыть детали" : "Подробнее"}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </Button>
        {job.status === "queued" && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                move("up");
              }}
              title="Move up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                move("down");
              }}
              title="Move down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {job.status === "done" && (job.output_path || meta?.output_path) && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              revealFile();
            }}
            title="Show in explorer"
          >
            <Film className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            openFolder();
          }}
          title="Open folder"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
        {isRunning ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              cancel();
            }}
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : job.status === "queued" ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              remove();
            }}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : job.status === "paused" ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void ipc.startQueue(maxConcurrentJobs);
            }}
            title="Resume"
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              remove();
            }}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <span className="ml-1 mt-0.5 w-12 text-right font-mono text-[11px] tabular text-fg-secondary">
        {isRunning ? `${percent.toFixed(0)}%` : job.status === "done" ? "100%" : "-"}
      </span>
    </div>
  );
}

function Detail({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <span className="mr-1 text-fg-tertiary">{label}:</span>
      <span className="break-all font-mono tabular text-fg-secondary" title={value}>
        {value}
      </span>
    </div>
  );
}

function formatMs(ms: number) {
  return formatDuration(ms / 1000);
}
