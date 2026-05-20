import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import type { ParsedLogLine } from "./LogRow";
import styles from "./LogsPage.module.css";

interface LogSummaryCardsProps {
  active: number;
  completed: number;
  logs: ParsedLogLine[];
}

export function LogSummaryCards({ active, completed, logs }: LogSummaryCardsProps) {
  const errors = logs.filter((line) => line.level === "error").length;
  const warnings = logs.filter((line) => line.level === "warning").length;

  return (
    <div className={styles.summaryGrid}>
      <SummaryCard label="Активные" value={active} icon="status" />
      <SummaryCard label="Ошибки" value={errors} icon="alert" tone="danger" />
      <SummaryCard label="Warnings" value={warnings} icon="info" tone="warning" />
      <SummaryCard label="Завершены" value={completed} icon="check" tone="success" />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: "status" | "alert" | "info" | "check";
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <section className={`${styles.panel} ${styles.summaryCard}`}>
      <div>
        <div className={styles.summaryLabel}>{label}</div>
        <div className={styles.summaryValue}>{value}</div>
      </div>
      <div
        className={[
          styles.summaryIcon,
          tone === "danger" ? styles.summaryIconDanger : "",
          tone === "warning" ? styles.summaryIconWarning : "",
          tone === "success" ? styles.summaryIconSuccess : "",
        ].join(" ")}
      >
        <RedesignIcon name={icon} />
      </div>
    </section>
  );
}
