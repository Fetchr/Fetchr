import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/job";

import styles from "./QueuePage.module.css";

export interface TaskStatusBadgeProps {
  status: JobStatus;
  label: string;
}

export function TaskStatusBadge({ status, label }: TaskStatusBadgeProps) {
  return (
    <span className={cn(styles.statusBadge, statusClassName(status))}>
      <span className={styles.statusDot} />
      {label}
    </span>
  );
}

function statusClassName(status: JobStatus): string {
  if (status === "running") return styles.statusRunning;
  if (status === "queued") return styles.statusQueued;
  if (status === "paused") return styles.statusPaused;
  if (status === "done") return styles.statusDone;
  if (status === "cancelled") return styles.statusCancelled;
  return styles.statusError;
}
