import { useMemo, useState } from "react";

import { ipc } from "@/lib/ipc";
import { useLogs } from "@/stores/logs";
import { useQueue } from "@/stores/queue";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import { LogDetailsPanel } from "./LogDetailsPanel";
import { LogFilters, type LogFilterState } from "./LogFilters";
import { parseLogLine, type ParsedLogLine } from "./LogRow";
import { LogSummaryCards } from "./LogSummaryCards";
import { LogTable, logKey } from "./LogTable";
import styles from "./LogsPage.module.css";

export function LogsPage() {
  const lines = useLogs((state) => state.lines);
  const clear = useLogs((state) => state.clear);
  const jobs = useQueue((state) => state.jobs);
  const [filters, setFilters] = useState<LogFilterState>({ job: "", source: "", text: "" });
  const [autoScroll, setAutoScroll] = useState(true);
  const [newestFirst, setNewestFirst] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const parsed = useMemo(() => lines.map(parseLogLine), [lines]);
  const filtered = useMemo(() => {
    const next = filterLogs(parsed, filters);
    return newestFirst ? next.slice().reverse() : next;
  }, [parsed, filters, newestFirst]);
  const selected = useMemo(
    () => filtered.find((line) => logKey(line) === selectedKey) ?? null,
    [filtered, selectedKey],
  );
  const active = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
  const completed = jobs.filter((job) => job.status === "done").length;

  const selectLog = (log: ParsedLogLine) => {
    setSelectedKey(logKey(log));
  };

  const clearLogs = () => {
    clear();
    setSelectedKey(null);
  };
  const jumpLatest = () => {
    const latest = newestFirst ? filtered[0] : filtered[filtered.length - 1];
    if (latest) setSelectedKey(logKey(latest));
  };
  const jumpErrors = () => {
    const error = filtered.find((line) => line.level === "error" || line.level === "warning");
    if (error) setSelectedKey(logKey(error));
  };
  const saveLogs = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const txt = formatLogsForExport(filtered);
    await ipc.saveTextFileDialog(`fetchr-log-${stamp}.txt`, txt);
  };

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Логи</h1>
          <div className={styles.subtitle}>События очереди, команд, источников и обработчиков Fetchr.</div>
        </div>
      </header>

      <LogSummaryCards active={active} completed={completed} logs={parsed} />

      <LogFilters
        filters={filters}
        autoScroll={autoScroll}
        total={parsed.length}
        visible={filtered.length}
        newestFirst={newestFirst}
        onFiltersChange={setFilters}
        onAutoScrollChange={setAutoScroll}
        onNewestFirstChange={setNewestFirst}
        onJumpLatest={jumpLatest}
        onJumpErrors={jumpErrors}
        onSave={saveLogs}
        onClear={clearLogs}
      />

      <main className={styles.content}>
        <LogTable
          logs={filtered}
          selectedId={selectedKey}
          autoScroll={autoScroll}
          newestFirst={newestFirst}
          onSelectLog={selectLog}
        />
        <LogDetailsPanel log={selected} />
      </main>
    </div>
  );
}

function formatLogsForExport(logs: ParsedLogLine[]) {
  const lines = logs.map((log) =>
    [
      new Date(log.ts).toISOString(),
      log.level.toUpperCase(),
      log.source,
      log.status,
      log.message,
    ].join(" | "),
  );
  const jsonl = logs.map((log) => JSON.stringify(log));
  return [
    "Fetchr logs",
    `Exported: ${new Date().toISOString()}`,
    `Rows: ${logs.length}`,
    "",
    "Text view",
    ...lines,
    "",
    "JSONL",
    ...jsonl,
    "",
  ].join("\n");
}

function filterLogs(logs: ParsedLogLine[], filters: LogFilterState) {
  const job = filters.job.trim().toLowerCase();
  const source = filters.source.trim().toLowerCase();
  const text = filters.text.trim().toLowerCase();

  return logs.filter((line) => {
    if (job && !line.id.toLowerCase().includes(job)) return false;
    if (source && !line.source.toLowerCase().includes(source)) return false;
    if (text) {
      const haystack = `${line.message} ${line.line} ${line.status} ${line.level}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}
