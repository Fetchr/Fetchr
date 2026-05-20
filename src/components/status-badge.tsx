import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/job";

const MAP: Record<
  JobStatus,
  { label: string; cls: string; dot?: string; pulse?: boolean }
> = {
  queued: {
    label: "QUEUED",
    cls: "border-border-default bg-elevated text-fg-tertiary",
    dot: "bg-fg-tertiary",
  },
  running: {
    label: "RUN",
    cls: "border-accent/40 bg-accent/15 text-accent",
    dot: "bg-accent",
    pulse: true,
  },
  paused: {
    label: "PAUSED",
    cls: "border-warning/40 bg-warning/15 text-warning",
    dot: "bg-warning",
  },
  done: {
    label: "DONE",
    cls: "border-success/40 bg-success/15 text-success",
    dot: "bg-success",
  },
  error: {
    label: "ERROR",
    cls: "border-danger/40 bg-danger/15 text-danger",
    dot: "bg-danger",
  },
  cancelled: {
    label: "CANCEL",
    cls: "border-fg-tertiary/40 bg-elevated text-fg-tertiary",
    dot: "bg-fg-tertiary",
  },
};

interface StatusBadgeProps {
  status: JobStatus;
  live?: boolean;
  className?: string;
}

export function StatusBadge({ status, live, className }: StatusBadgeProps) {
  const meta = live
    ? {
        label: "LIVE",
        cls: "border-live/40 bg-live/15 text-live",
        dot: "bg-live",
        pulse: true,
      }
    : MAP[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5",
        "font-mono text-[10px] font-bold uppercase leading-none tracking-wider",
        meta.cls,
        className,
      )}
    >
      {meta.dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            meta.dot,
            meta.pulse && "animate-pulse-live",
          )}
        />
      )}
      {meta.label}
    </span>
  );
}
