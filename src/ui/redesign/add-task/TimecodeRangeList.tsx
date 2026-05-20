import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./AddTaskModal.module.css";

export interface TimecodeRange {
  id: string;
  start: string;
  end: string;
}

export interface TimecodeRangeListProps {
  start: string;
  end: string;
  ranges: TimecodeRange[];
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAddRange: () => void;
  onUpdateRange: (id: string, patch: Partial<Pick<TimecodeRange, "start" | "end">>) => void;
  onRemoveRange: (id: string) => void;
}

export function TimecodeRangeList({
  start,
  end,
  ranges,
  onStartChange,
  onEndChange,
  onAddRange,
  onUpdateRange,
  onRemoveRange,
}: TimecodeRangeListProps) {
  return (
    <div className={styles.ranges}>
      <div className={styles.rangeEditor}>
        <input className={styles.input} value={start} onChange={(event) => onStartChange(event.currentTarget.value)} placeholder="00:00:00" />
        <span className={styles.sectionMeta}>-</span>
        <input className={styles.input} value={end} onChange={(event) => onEndChange(event.currentTarget.value)} placeholder="00:00:00" />
        <button className={styles.button} type="button" onClick={onAddRange}>
          <RedesignIcon name="add" className="size-[15px]" />
          Добавить диапазон
        </button>
      </div>

      <div className={styles.rangeList}>
        {ranges.length === 0 ? (
          <div className={styles.hint}>Диапазоны не добавлены</div>
        ) : (
          ranges.map((range, index) => (
            <div className={styles.rangeItem} key={range.id}>
              <span className={styles.rangeIndex}>#{index + 1}</span>
              <input
                className={styles.input}
                value={range.start}
                onChange={(event) => onUpdateRange(range.id, { start: event.currentTarget.value })}
                placeholder="00:00:00"
              />
              <span className={styles.sectionMeta}>до</span>
              <input
                className={styles.input}
                value={range.end}
                onChange={(event) => onUpdateRange(range.id, { end: event.currentTarget.value })}
                placeholder="00:00:00"
              />
              <button className={styles.iconButton} type="button" aria-label="Удалить диапазон" onClick={() => onRemoveRange(range.id)}>
                <RedesignIcon name="trash" className="size-[14px]" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
