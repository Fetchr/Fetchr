import { cn } from "@/lib/utils";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./BottomActionBar.module.css";

export interface BottomActionBarDisabledStates {
  duplicate?: boolean;
  clear?: boolean;
  save?: boolean;
  run?: boolean;
  dropdown?: boolean;
}

export interface BottomActionBarProps {
  onDuplicate: () => void;
  onClear: () => void;
  onSave: () => void;
  onRun: () => void;
  onOpenRunMenu?: () => void;
  disabled?: BottomActionBarDisabledStates;
  isRunning?: boolean;
  className?: string;
}

export function BottomActionBar({
  onDuplicate,
  onClear,
  onSave,
  onRun,
  onOpenRunMenu,
  disabled,
  isRunning = false,
  className,
}: BottomActionBarProps) {
  const runLabel = isRunning ? "Запущено" : "Запустить";

  return (
    <div className={cn(fetchrThemeClassName, styles.bar, className)}>
      <div className={styles.group}>
        <button className={styles.button} type="button" onClick={onDuplicate} disabled={disabled?.duplicate}>
          <RedesignIcon name="copy" className="size-[15px]" />
          Дублировать
        </button>
        <button className={styles.button} type="button" onClick={onClear} disabled={disabled?.clear}>
          <RedesignIcon name="trash" className="size-[15px]" />
          Очистить
        </button>
      </div>

      <div className={styles.separator} aria-hidden />

      <div className={styles.group}>
        <button className={styles.button} type="button" onClick={onSave} disabled={disabled?.save}>
          <RedesignIcon name="save" className="size-[15px]" />
          Сохранить
        </button>
        <div className={styles.primaryGroup}>
          <button className={styles.primaryButton} type="button" onClick={onRun} disabled={disabled?.run || isRunning}>
            <RedesignIcon name={isRunning ? "loading" : "play"} className="size-[15px]" />
            {runLabel}
          </button>
          {onOpenRunMenu && (
            <button
              className={styles.dropdownButton}
              type="button"
              aria-label="Дополнительные действия запуска"
              onClick={onOpenRunMenu}
              disabled={disabled?.dropdown}
            >
              <RedesignIcon name="chevronDown" className="size-[15px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
