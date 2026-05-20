import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/job";

import styles from "./QueuePage.module.css";

export interface TaskProgressBarProps {
  value: number;
  status: JobStatus;
  downloadedLabel?: string;
  totalLabel?: string;
  stageValue?: number | null;
  stageLabel?: string | null;
}

export function TaskProgressBar({ value, status, downloadedLabel, totalLabel, stageValue, stageLabel }: TaskProgressBarProps) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const stagePercent = stageValue == null ? null : Math.max(0, Math.min(100, Number.isFinite(stageValue) ? stageValue : 0));
  const title = [
    downloadedLabel && totalLabel ? `${downloadedLabel} / ${totalLabel}` : `${Math.round(percent)}%`,
    stagePercent != null ? `${stageLabel ?? "stage"}: ${Math.round(stagePercent)}%` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={styles.progressCell} title={title}>
      <div className={styles.progressTrack}>
        <div
          className={cn(
            styles.progressFill,
            status === "done" && styles.progressDone,
            (status === "error" || status === "cancelled") && styles.progressError,
          )}
          style={{ width: `${percent}%` }}
        />
        {stagePercent != null && (
          <div className={styles.progressStageFill} style={{ width: `${stagePercent}%` }} />
        )}
      </div>
      <span className={styles.progressValue}>{Math.round(percent)}%</span>
    </div>
  );
}
