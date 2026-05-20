import { cn } from "@/lib/utils";

import styles from "./LeftNavigation.module.css";

export type EngineStatus = "active" | "warning" | "inactive";

export interface SystemStatusCardProps {
  engineStatus?: EngineStatus;
  engineLabel?: string;
  streams: string;
  cpu: string;
  ram: string;
  disk: string;
  className?: string;
}

export function SystemStatusCard({
  engineStatus = "active",
  engineLabel = "Активен",
  streams,
  cpu,
  ram,
  disk,
  className,
}: SystemStatusCardProps) {
  return (
    <section className={cn(styles.card, styles.systemCard, className)} aria-label="Состояние системы">
      <div className={styles.cardHeader}>
        <span>Движок</span>
        <span className={cn(styles.engineStatus, getEngineStatusClassName(engineStatus))}>
          <span className={styles.statusDot} />
          {engineLabel}
        </span>
      </div>

      <div className={styles.metricList}>
        <Metric label="Потоки" value={streams} />
        <Metric label="CPU" value={cpu} />
        <Metric label="RAM" value={ram} />
        <Metric label="Диск" value={disk} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

function getEngineStatusClassName(status: EngineStatus): string | undefined {
  if (status === "warning") return styles.engineStatusWarning;
  if (status === "inactive") return styles.engineStatusInactive;
  return undefined;
}
