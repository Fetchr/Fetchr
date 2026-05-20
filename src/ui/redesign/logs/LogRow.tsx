import type { LogLine } from "@/lib/ipc";

import styles from "./LogsPage.module.css";

export type LogLevel = "info" | "warning" | "error" | "debug";
export type LogStatus = "active" | "warning" | "error" | "completed" | "idle";

export interface ParsedLogLine extends LogLine {
  level: LogLevel;
  source: string;
  message: string;
  status: LogStatus;
  action: string | null;
  details: string | null;
}

interface LogRowProps {
  log: ParsedLogLine;
  selected: boolean;
  onSelect: (log: ParsedLogLine) => void;
}

export function LogRow({ log, selected, onSelect }: LogRowProps) {
  return (
    <button
      type="button"
      className={[
        styles.row,
        selected ? styles.rowSelected : "",
        log.level === "error" ? styles.rowError : "",
        log.level === "warning" ? styles.rowWarn : "",
      ].join(" ")}
      onClick={() => onSelect(log)}
      aria-selected={selected}
    >
      <span className={`${styles.time} ${styles.mono}`}>{formatTime(log.ts)}</span>
      <span className={`${styles.badge} ${levelClass(log.level)}`}>{levelLabel(log.level)}</span>
      <span className={`${styles.source} ${styles.mono}`} title={log.source}>
        {log.source}
      </span>
      <span className={styles.message} title={log.message}>
        {log.message}
      </span>
      <span className={styles.status}>{statusLabel(log.status)}</span>
    </button>
  );
}

export function parseLogLine(line: LogLine): ParsedLogLine {
  const raw = line.line.trim();
  const withoutWarnPrefix = raw.startsWith("!! ") ? raw.slice(3).trim() : raw;
  const actionMatch = withoutWarnPrefix.match(/^([a-z0-9_:-]+):\s*(.*)$/i);
  const action = actionMatch?.[1] ?? null;
  const message = actionMatch?.[2]?.trim() || withoutWarnPrefix || raw;
  const haystack = `${line.id} ${raw}`.toLowerCase();
  const level = inferLevel(raw, haystack);
  return {
    ...line,
    level,
    source: action ? `${line.id}:${action}` : line.id,
    message,
    status: inferStatus(level, haystack),
    action,
    details: action ? raw : null,
  };
}

function inferLevel(raw: string, haystack: string): LogLevel {
  if (isBenignProcessLine(raw, haystack)) return "info";
  if (raw.startsWith("!!") || haystack.includes("error:") || haystack.includes("failed") || haystack.includes("panic")) {
    return "error";
  }
  if (haystack.includes("warn") || haystack.includes("fallback") || haystack.includes("stderr")) return "warning";
  if (haystack.includes("stdout") || haystack.startsWith("system $")) return "debug";
  return "info";
}

function isBenignProcessLine(raw: string, haystack: string) {
  const cleaned = raw.replace(/^!!\s*/, "").trim().toLowerCase();
  return (
    cleaned.startsWith("ffmpeg version") ||
    cleaned.startsWith("libav") ||
    cleaned.startsWith("configuration:") ||
    cleaned.startsWith("input #") ||
    cleaned.startsWith("output #") ||
    cleaned.startsWith("metadata:") ||
    cleaned.startsWith("stream #") ||
    cleaned.startsWith("duration:") ||
    cleaned.startsWith("press [q]") ||
    cleaned.startsWith("frame=") ||
    cleaned.includes(" opening 'http") ||
    cleaned.includes("found duplicated moov atom") ||
    cleaned.includes("handler_name") ||
    cleaned.includes("major_brand") ||
    cleaned.includes("minor_version") ||
    cleaned.includes("compatible_brands") ||
    cleaned.includes("variant_bitrate") ||
    haystack.includes("video:")
  );
}

function inferStatus(level: LogLevel, haystack: string): LogStatus {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  if (haystack.includes("finished") || haystack.includes("completed") || haystack.includes("done") || haystack.includes("saved")) {
    return "completed";
  }
  if (haystack.includes("started") || haystack.includes("running") || haystack.includes("queued")) return "active";
  return "idle";
}

function levelClass(level: LogLevel) {
  if (level === "error") return styles.badgeError;
  if (level === "warning") return styles.badgeWarn;
  if (level === "debug") return styles.badgeDebug;
  return styles.badgeInfo;
}

function levelLabel(level: LogLevel) {
  if (level === "error") return "error";
  if (level === "warning") return "warn";
  if (level === "debug") return "debug";
  return "info";
}

function statusLabel(status: LogStatus) {
  if (status === "active") return "активно";
  if (status === "warning") return "warning";
  if (status === "error") return "ошибка";
  if (status === "completed") return "готово";
  return "idle";
}

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}
