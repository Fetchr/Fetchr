import { cn } from "@/lib/utils";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./QueuePage.module.css";
import type { QueueCounts, QueueFilter } from "./taskUiTypes";

export interface QueueHeaderProps {
  activeFilter: QueueFilter;
  counts: QueueCounts;
  running: boolean;
  canStart: boolean;
  onFilterChange: (filter: QueueFilter) => void;
  onAddTask: () => void;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onClearCompleted: () => void;
}

const filters: Array<{ id: QueueFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "queued", label: "В очереди" },
  { id: "done", label: "Завершены" },
  { id: "error", label: "Ошибки" },
];

export function QueueHeader({
  activeFilter,
  counts,
  running,
  canStart,
  onFilterChange,
  onAddTask,
  onStartQueue,
  onPauseQueue,
  onClearCompleted,
}: QueueHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Очередь задач</h1>
          <span className={styles.titleMeta}>{counts.all} задач</span>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.button} type="button" onClick={onClearCompleted} disabled={counts.done === 0}>
            <RedesignIcon name="trash" className="size-[15px]" />
            Очистить
          </button>
          {running ? (
            <button className={styles.button} type="button" onClick={onPauseQueue}>
              <RedesignIcon name="pause" className="size-[15px]" />
              Пауза
            </button>
          ) : (
            <button className={cn(styles.button, styles.primaryButton)} type="button" onClick={onStartQueue} disabled={!canStart}>
              <RedesignIcon name="play" className="size-[15px]" />
              Запустить
            </button>
          )}
          <button className={styles.button} type="button" onClick={onAddTask}>
            <RedesignIcon name="add" className="size-[15px]" />
            Добавить
          </button>
        </div>
      </div>

      <div className={styles.tableToolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Фильтры очереди">
          {filters.map((filter) => (
            <button
              className={cn(styles.tab, activeFilter === filter.id && styles.tabActive)}
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={activeFilter === filter.id}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label}
              <span className={styles.tabCount}>{counts[filter.id]}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
