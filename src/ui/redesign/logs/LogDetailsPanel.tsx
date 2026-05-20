import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import type { ParsedLogLine } from "./LogRow";
import styles from "./LogsPage.module.css";

interface LogDetailsPanelProps {
  log: ParsedLogLine | null;
}

export function LogDetailsPanel({ log }: LogDetailsPanelProps) {
  return (
    <aside className={`${styles.panel} ${styles.details}`}>
      <div className={styles.detailsHeader}>
        <div className={styles.detailsTitle}>
          <RedesignIcon name={log?.level === "error" ? "alert" : "logs"} />
          Детали
        </div>
        {log && <span className={`${styles.badge} ${styles.badgeInfo}`}>{log.level}</span>}
      </div>
      <div className={styles.detailsBody}>
        {!log ? (
          <div className={styles.empty}>Выберите строку лога</div>
        ) : (
          <div className={styles.detailsGrid}>
            <Detail label="Время" value={formatDateTime(log.ts)} />
            <Detail label="Job / source" value={log.source} mono />
            <Detail label="Action" value={log.action ?? "-"} mono />
            <Detail label="Status" value={log.status} />
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Message</span>
              <pre className={`${styles.detailPre} ${styles.mono}`}>{log.message}</pre>
            </div>
            {(log.level === "error" || log.details) && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Expanded error details</span>
                <pre className={`${styles.detailPre} ${styles.mono}`}>{log.details ?? log.line}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.detailItem}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={`${styles.detailValue} ${mono ? styles.mono : ""}`}>{value}</span>
    </div>
  );
}

function formatDateTime(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}
