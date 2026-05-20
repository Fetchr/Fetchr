import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./LogsPage.module.css";

export interface LogFilterState {
  job: string;
  source: string;
  text: string;
}

interface LogFiltersProps {
  filters: LogFilterState;
  autoScroll: boolean;
  total: number;
  visible: number;
  newestFirst: boolean;
  onFiltersChange: (filters: LogFilterState) => void;
  onAutoScrollChange: (value: boolean) => void;
  onNewestFirstChange: (value: boolean) => void;
  onJumpLatest: () => void;
  onJumpErrors: () => void;
  onSave: () => void;
  onClear: () => void;
}

export function LogFilters({
  filters,
  autoScroll,
  total,
  visible,
  newestFirst,
  onFiltersChange,
  onAutoScrollChange,
  onNewestFirstChange,
  onJumpLatest,
  onJumpErrors,
  onSave,
  onClear,
}: LogFiltersProps) {
  return (
    <section className={`${styles.panel} ${styles.filters}`}>
      <label className={styles.field}>
        <span className={styles.label}>Job</span>
        <input
          className={`${styles.input} ${styles.mono}`}
          value={filters.job}
          placeholder="job id"
          onChange={(event) => onFiltersChange({ ...filters, job: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Source</span>
        <input
          className={`${styles.input} ${styles.mono}`}
          value={filters.source}
          placeholder="system, twitch..."
          onChange={(event) => onFiltersChange({ ...filters, source: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Текст</span>
        <input
          className={styles.input}
          value={filters.text}
          placeholder="Фильтр по сообщению..."
          onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
        />
      </label>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(event) => onAutoScrollChange(event.target.checked)}
        />
        Автопрокрутка
      </label>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={newestFirst}
          onChange={(event) => onNewestFirstChange(event.target.checked)}
        />
        Новые сверху
      </label>
      <button className={styles.button} type="button" onClick={onJumpLatest} disabled={visible === 0}>
        <RedesignIcon name="move" />
        К последнему
      </button>
      <button className={styles.button} type="button" onClick={onJumpErrors} disabled={visible === 0}>
        <RedesignIcon name="alert" />
        К ошибкам
      </button>
      <button className={styles.button} type="button" onClick={onSave} disabled={visible === 0}>
        <RedesignIcon name="exportJson" />
        Сохранить лог
      </button>
      <button className={styles.button} type="button" onClick={onClear} disabled={total === 0}>
        <RedesignIcon name="trash" />
        Очистить
      </button>
      <span className={styles.status}>
        Показано {visible} из {total}
      </span>
    </section>
  );
}
