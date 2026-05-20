import { ListFilter, Rows3 } from "lucide-react";

import { GraphitePanel } from "@/components/graphite-panel";
import { Button } from "@/components/ui/button";
import { QueueTaskRow } from "@/features/queue/queue-task-row";
import type { Job, JobStatus } from "@/types/job";

interface QueueTaskTableProps {
  jobs: Job[];
  presetName: string;
  activeFilter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  counts: Record<QueueFilter, number>;
}

export type QueueFilter = "all" | "active" | "queued" | "done" | "error";

const filters: Array<{ id: QueueFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "queued", label: "В очереди" },
  { id: "done", label: "Завершены" },
  { id: "error", label: "Ошибки" },
];

const columns = ["Название", "Источник", "Пресет", "Статус", "Скорость", "ETA", "Прогресс", "Действия"];

export function QueueTaskTable({
  jobs,
  presetName,
  activeFilter,
  onFilterChange,
  counts,
}: QueueTaskTableProps) {
  return (
    <GraphitePanel
      className="flex min-h-0 flex-1 flex-col"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      action={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <Rows3 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="sm">
            <ListFilter className="h-3.5 w-3.5" />
            Фильтры
          </Button>
        </div>
      }
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <div className="flex items-center gap-1">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              className={
                "inline-flex h-8 items-center gap-2 rounded px-3 text-[12px] transition " +
                (activeFilter === filter.id
                  ? "bg-accent/18 text-fg-primary shadow-[inset_0_0_0_1px_hsl(var(--accent)/0.38)]"
                  : "text-fg-tertiary hover:bg-elevated hover:text-fg-secondary")
              }
            >
              {filter.label}
              <span className="rounded bg-elevated px-1.5 py-[1px] font-mono text-[10px] text-fg-secondary">
                {counts[filter.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid h-9 shrink-0 grid-cols-[minmax(260px,1.8fr)_minmax(170px,1fr)_116px_150px_118px_94px_minmax(150px,1fr)_96px] items-center gap-4 border-b border-border-subtle px-4 text-[10px] font-semibold uppercase text-fg-tertiary">
        {columns.map((column) => (
          <div key={column} className={column === "Действия" ? "text-right" : ""}>
            {column}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {jobs.length === 0 ? (
          <div className="grid h-full min-h-64 place-items-center text-center">
            <div>
              <div className="text-[13px] font-medium text-fg-secondary">Задач нет</div>
              <div className="mt-1 text-[11px] text-fg-tertiary">
                Добавьте stream, VOD или HLS-источник, чтобы поставить загрузку в очередь.
              </div>
            </div>
          </div>
        ) : (
          jobs.map((job) => <QueueTaskRow key={job.id} job={job} presetName={presetName} />)
        )}
      </div>
    </GraphitePanel>
  );
}

export function filterJobs(jobs: Job[], filter: QueueFilter) {
  if (filter === "all") return jobs;
  if (filter === "active") {
    return jobs.filter((job) => job.status === "running" || job.status === "paused");
  }
  return jobs.filter((job) => statusMatches(job.status, filter));
}

function statusMatches(status: JobStatus, filter: QueueFilter) {
  if (filter === "queued") return status === "queued";
  if (filter === "done") return status === "done";
  if (filter === "error") return status === "error";
  return true;
}
