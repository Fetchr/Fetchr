import { useEffect, useRef } from "react";

import { LogRow, type ParsedLogLine } from "./LogRow";
import styles from "./LogsPage.module.css";

interface LogTableProps {
  logs: ParsedLogLine[];
  selectedId: string | null;
  autoScroll: boolean;
  newestFirst: boolean;
  onSelectLog: (log: ParsedLogLine) => void;
}

export function LogTable({ logs, selectedId, autoScroll, newestFirst, onSelectLog }: LogTableProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = newestFirst ? 0 : bodyRef.current.scrollHeight;
  }, [logs.length, autoScroll, newestFirst]);

  useEffect(() => {
    if (!selectedId || !bodyRef.current) return;
    bodyRef.current
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <section className={`${styles.panel} ${styles.tablePanel}`}>
      <div className={styles.tableHeader}>
        <span>Время</span>
        <span>Level</span>
        <span>Job / source</span>
        <span>Сообщение</span>
        <span>Status</span>
      </div>
      <div ref={bodyRef} className={styles.tableBody}>
        {logs.length === 0 ? (
          <div className={styles.empty}>Логи пусты</div>
        ) : (
          logs.map((log) => (
            <LogRow
              key={`${log.id}:${log.ts}:${log.line}`}
              log={log}
              selected={selectedId === logKey(log)}
              onSelect={onSelectLog}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function logKey(log: ParsedLogLine) {
  return `${log.id}:${log.ts}:${log.line}`;
}
