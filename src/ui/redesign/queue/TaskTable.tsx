import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./QueuePage.module.css";
import { TaskRow } from "./TaskRow";
import type { QueueSummary, QueueTaskActions, QueueTaskUi } from "./taskUiTypes";

export interface TaskTableProps {
  tasks: QueueTaskUi[];
  summary: QueueSummary;
  autoscroll: boolean;
  onAutoscrollChange: (value: boolean) => void;
  actions?: QueueTaskActions;
}

const columns = [
  "Название",
  "Источник",
  "Пресет",
  "Статус",
  "Скорость",
  "ETA",
  "Размер",
  "Прогресс",
  "Добавлен",
  "",
];

export function TaskTable({ tasks, summary, autoscroll, onAutoscrollChange, actions }: TaskTableProps) {
  return (
    <section className={`${styles.panel} ${styles.tablePanel}`} aria-label="Очередь загрузок">
      <div className={styles.tableToolbar}>
        <div className={styles.viewButtons}>
          <button className={styles.iconButton} type="button" aria-label="Таблица">
            <RedesignIcon name="queue" className="size-[15px]" />
          </button>
          <button className={styles.button} type="button">
            <RedesignIcon name="preset" className="size-[15px]" />
            Фильтры
          </button>
        </div>
      </div>

      <div className={styles.tableScroll}>
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            {columns.map((column) => (
              <div key={column}>{column}</div>
            ))}
          </div>

          {tasks.length === 0 ? (
            <div className={styles.empty}>
              <div>
                <div className={styles.emptyTitle}>Задач нет</div>
                <div className={styles.emptyText}>Добавьте stream, VOD или HLS-источник, чтобы поставить загрузку в очередь.</div>
              </div>
            </div>
          ) : (
            tasks.map((task) => <TaskRow key={task.id} task={task} actions={actions} />)
          )}
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryStats}>
          <span>{summary.taskCount} задач</span>
          <span>Активные загрузки: {summary.activeDownloads}</span>
          <span>Скорость: {summary.speed}</span>
          <span>Одновременных потоков: {summary.threads}</span>
        </div>
        <label className={styles.toggle}>
          Автопрокрутка
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(event) => onAutoscrollChange(event.currentTarget.checked)}
          />
        </label>
      </div>
    </section>
  );
}
