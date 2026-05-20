import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./SponsorBlurPage.module.css";

interface SponsorBlurToolbarProps {
  showZones: boolean;
  showGrid: boolean;
  applyDuringRender: boolean;
  saved: boolean;
  onAddZone: () => void;
  onToggleZones: (value: boolean) => void;
  onToggleGrid: (value: boolean) => void;
  onSavePreset: () => void;
  onApplyDuringRenderChange: (value: boolean) => void;
}

export function SponsorBlurToolbar({
  showZones,
  showGrid,
  applyDuringRender,
  saved,
  onAddZone,
  onToggleZones,
  onToggleGrid,
  onSavePreset,
  onApplyDuringRenderChange,
}: SponsorBlurToolbarProps) {
  return (
    <section className={`${styles.panel} ${styles.toolbar}`}>
      <div className={styles.toolbarGroup}>
        <button className={styles.button} type="button" onClick={onAddZone}>
          <RedesignIcon name="add" />
          Добавить зону
        </button>
        <button className={styles.button} type="button" onClick={() => onToggleZones(!showZones)}>
          <RedesignIcon name={showZones ? "visible" : "hidden"} />
          Видимость
        </button>
        <button className={styles.button} type="button" onClick={() => onToggleGrid(!showGrid)}>
          <RedesignIcon name="preset" />
          Сетка
        </button>
      </div>

      <div className={styles.toolbarGroup}>
        <label className={styles.toggleRow}>
          <span>Применять при рендере</span>
          <input
            type="checkbox"
            checked={applyDuringRender}
            onChange={(event) => onApplyDuringRenderChange(event.target.checked)}
          />
        </label>
        <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onSavePreset}>
          <RedesignIcon name={saved ? "check" : "save"} />
          {saved ? "Сохранено" : "Сохранить пресет"}
        </button>
      </div>
    </section>
  );
}
