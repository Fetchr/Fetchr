import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { ipc, onQueueChanged } from "@/lib/ipc";
import type { Job } from "@/types/job";

interface QueueState {
  jobs: Job[];
  initialized: boolean;
  setJobs: (jobs: Job[]) => void;
  init: () => Promise<() => void>;
}

export const useQueue = create<QueueState>((set, get) => ({
  jobs: [],
  initialized: false,
  setJobs: (jobs) => set({ jobs }),
  async init() {
    if (get().initialized) return () => {};
    set({ initialized: true });
    try {
      const jobs = await ipc.listJobs();
      set({ jobs });
    } catch {
      // ignore until backend is ready
    }
    const unlisten = await onQueueChanged((jobs) => set({ jobs }));
    return unlisten;
  },
}));

export function useJobCounts() {
  return useQueue(
    useShallow((s) => {
      const counts = { queued: 0, running: 0, done: 0, error: 0, paused: 0 };
      for (const j of s.jobs) {
        if (j.status === "queued") counts.queued += 1;
        else if (j.status === "running") counts.running += 1;
        else if (j.status === "done") counts.done += 1;
        else if (j.status === "error") counts.error += 1;
        else if (j.status === "paused") counts.paused += 1;
      }
      return counts;
    }),
  );
}
