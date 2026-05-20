import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/kbd";
import { PresetInlineAction } from "@/components/preset-inline-action";
import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { QueuePipeline } from "@/features/queue/queue-pipeline";
import {
  QueueTaskTable,
  filterJobs,
  type QueueFilter,
} from "@/features/queue/queue-task-table";
import { QueuePage as RedesignQueuePage } from "@/ui/redesign/queue";

import { ipc } from "@/lib/ipc";
import { useJobCounts, useQueue } from "@/stores/queue";
import { usePresets } from "@/stores/presets";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

export function QueuePage() {
  if (isFetchrRedesignEnabled()) return <RedesignQueuePage />;
  return <LegacyQueuePage />;
}

function LegacyQueuePage() {
  const { t } = useTranslation();
  const jobs = useQueue((s) => s.jobs);
  const counts = useJobCounts();
  const openAdd = useUI((s) => s.openAddDialog);
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);
  const presets = usePresets((s) => s.presets);
  const activePresetId = usePresets((s) => s.activePresetId);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const [filter, setFilter] = useState<QueueFilter>("all");

  const running = counts.running > 0;
  const filteredJobs = useMemo(() => filterJobs(jobs, filter), [filter, jobs]);
  const filterCounts = useMemo(
    () => ({
      all: jobs.length,
      active: jobs.filter((job) => job.status === "running" || job.status === "paused").length,
      queued: counts.queued,
      done: counts.done,
      error: counts.error,
    }),
    [counts.done, counts.error, counts.queued, jobs],
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-5 py-4">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[16px] font-semibold text-fg-primary">{t("nav.queue")}</h1>
          <div className="flex items-center gap-3 text-[11px] text-fg-tertiary">
            <span className="font-mono tabular">{counts.queued} {t("queue.queued")}</span>
            <span className="font-mono tabular text-accent">{counts.running} {t("queue.running")}</span>
            <span className="font-mono tabular text-success">{counts.done} {t("queue.done")}</span>
            {counts.error > 0 && (
              <span className="font-mono tabular text-danger">{counts.error} ERROR</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <PresetInlineAction featureId="logs" label="Очередь и логи" />
          <Button variant="ghost" size="md" onClick={() => ipc.clearCompleted()}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("queue.clear_done")}
          </Button>
          {running ? (
            <Button variant="secondary" size="md" onClick={() => ipc.pauseQueue()}>
              <Pause className="h-3.5 w-3.5" />
              {t("queue.pause")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              onClick={() => ipc.startQueue(maxConcurrentJobs)}
              disabled={counts.queued === 0}
            >
              <Play className="h-3.5 w-3.5" />
              {t("queue.start")}
            </Button>
          )}
          <Button variant="primary" size="md" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("queue.add")}
            <Kbd className="ml-1 border-white/20 bg-black/20 text-white/80">Ctrl+N</Kbd>
          </Button>
        </div>
      </header>

      <QueueTaskTable
        jobs={filteredJobs}
        presetName={activePreset?.name ?? "Fast Save"}
        activeFilter={filter}
        onFilterChange={setFilter}
        counts={filterCounts}
      />
      <QueuePipeline
        presetName={activePreset?.name ?? "Fast Save"}
        features={activePreset?.features ?? []}
      />
    </div>
  );
}
