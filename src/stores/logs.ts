import { create, type StoreApi } from "zustand";

import { onJobLog, type LogLine } from "@/lib/ipc";

interface LogsState {
  lines: LogLine[];
  initialized: boolean;
  clear: (id?: string) => void;
  init: () => Promise<() => void>;
}

const MAX_LINES = 10000;
const MAX_BATCH = 250;

let pending: LogLine[] = [];
let flushHandle: number | null = null;

type SetLogsState = StoreApi<LogsState>["setState"];

function scheduleFlush(set: SetLogsState) {
  if (flushHandle !== null) return;
  flushHandle = window.setTimeout(() => {
    flushHandle = null;
    const batch = pending.splice(0, MAX_BATCH);
    if (pending.length > 0) {
      scheduleFlush(set);
    }
    if (batch.length === 0) return;
    set((s) => {
      const next = s.lines.concat(batch);
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return { lines: next };
    });
  }, 50);
}

export const useLogs = create<LogsState>((set, get) => ({
  lines: [],
  initialized: false,
  clear: (id) =>
    set((s) => ({
      lines: id ? s.lines.filter((l) => l.id !== id) : [],
    })),
  async init() {
    if (get().initialized) return () => {};
    set({ initialized: true });
    const unlisten = await onJobLog((line) => {
      pending.push(line);
      if (pending.length > MAX_LINES) {
        pending.splice(0, pending.length - MAX_LINES);
      }
      scheduleFlush(set);
    });
    return () => {
      if (flushHandle !== null) {
        window.clearTimeout(flushHandle);
        flushHandle = null;
      }
      pending = [];
      unlisten();
    };
  },
}));
