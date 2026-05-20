import type { BlurEffect, BlurZone, ImageFit } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./SponsorBlurPage.module.css";

export type SponsorZoneShape = "rectangle" | "ellipse";

export interface SponsorZoneUiSettings {
  name: string;
  shape: SponsorZoneShape;
  edgeSoftness: number;
  padding: number;
  adaptiveSize: boolean;
}

interface SponsorZonePropertiesProps {
  zone: BlurZone | null;
  ui: SponsorZoneUiSettings | null;
  onChangeZone: (id: string, patch: Partial<BlurZone>) => void;
  onChangeUi: (id: string, patch: Partial<SponsorZoneUiSettings>) => void;
  onDeleteZone: (id: string) => void;
  onChooseZoneImage: (id: string) => void;
}

export function SponsorZoneProperties({
  zone,
  ui,
  onChangeZone,
  onChangeUi,
  onDeleteZone,
  onChooseZoneImage,
}: SponsorZonePropertiesProps) {
  if (!zone || !ui) {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Свойства зоны</div>
          <RedesignIcon name="settings" />
        </div>
        <div className={styles.panelBody}>
          <div className={styles.statusBox}>Выберите или добавьте зону.</div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Свойства зоны</div>
        <RedesignIcon name="settings" />
      </div>
      <div className={`${styles.panelBody} ${styles.propertiesGrid}`}>
        <label className={styles.field}>
          <span className={styles.label}>Имя</span>
          <input
            className={styles.input}
            value={ui.name}
            onChange={(event) => onChangeUi(zone.id, { name: event.target.value })}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Форма</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segment} ${ui.shape === "rectangle" ? styles.segmentActive : ""}`}
              onClick={() => onChangeUi(zone.id, { shape: "rectangle" })}
            >
              Прямоугольник
            </button>
            <button
              type="button"
              className={`${styles.segment} ${ui.shape === "ellipse" ? styles.segmentActive : ""}`}
              onClick={() => onChangeUi(zone.id, { shape: "ellipse" })}
              title="Эллипс сохраняется как UI-настройка, обработка использует существующую прямоугольную зону."
            >
              Эллипс
            </button>
          </div>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Эффект</span>
          <select
            className={styles.select}
            value={zone.effect}
            onChange={(event) => onChangeZone(zone.id, { effect: event.target.value as BlurEffect })}
          >
            <option value="gaussian_blur">Блюр</option>
            <option value="mosaic">Mosaic</option>
            <option value="image_overlay">Image overlay</option>
          </select>
        </label>

        <RangeField
          label="Сила"
          value={zone.intensity}
          suffix="%"
          min={1}
          max={100}
          onChange={(intensity) => onChangeZone(zone.id, { intensity })}
        />
        <RangeField
          label="Мягкость краёв"
          value={ui.edgeSoftness}
          suffix="px"
          min={0}
          max={80}
          onChange={(edgeSoftness) => onChangeUi(zone.id, { edgeSoftness })}
        />
        <RangeField
          label="Отступ внутри"
          value={ui.padding}
          suffix="px"
          min={0}
          max={80}
          onChange={(padding) => onChangeUi(zone.id, { padding })}
        />

        <label className={styles.toggleRow}>
          <span>Адаптивный размер</span>
          <input
            type="checkbox"
            checked={ui.adaptiveSize}
            onChange={(event) => onChangeUi(zone.id, { adaptiveSize: event.target.checked })}
          />
        </label>

        <div className={styles.twoColumn}>
          <NumberField label="X" value={zone.x} onChange={(x) => onChangeZone(zone.id, { x })} />
          <NumberField label="Y" value={zone.y} onChange={(y) => onChangeZone(zone.id, { y })} />
          <NumberField label="W" value={zone.width} onChange={(width) => onChangeZone(zone.id, { width })} />
          <NumberField label="H" value={zone.height} onChange={(height) => onChangeZone(zone.id, { height })} />
        </div>

        {zone.effect === "image_overlay" && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Image path</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={zone.image_path ?? ""}
                onChange={(event) => onChangeZone(zone.id, { image_path: event.target.value })}
              />
            </label>
            <div className={styles.twoColumn}>
              <button className={styles.button} type="button" onClick={() => onChooseZoneImage(zone.id)}>
                <RedesignIcon name="image" />
                Файл
              </button>
              <label className={styles.field}>
                <span className={styles.label}>Fit</span>
                <select
                  className={styles.select}
                  value={zone.image_fit ?? "contain"}
                  onChange={(event) => onChangeZone(zone.id, { image_fit: event.target.value as ImageFit })}
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                  <option value="stretch">Stretch</option>
                </select>
              </label>
            </div>
          </>
        )}

        <button className={`${styles.button} ${styles.dangerButton}`} type="button" onClick={() => onDeleteZone(zone.id)}>
          <RedesignIcon name="trash" />
          Удалить зону
        </button>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={`${styles.input} ${styles.mono}`}
        type="number"
        value={Math.round(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </label>
  );
}

function RangeField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <span className={styles.rangeRow}>
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          value={Math.round(value)}
          onChange={(event) => onChange(Number(event.target.value) || min)}
        />
        <span className={`${styles.input} ${styles.mono}`}>{Math.round(value)} {suffix}</span>
      </span>
    </label>
  );
}
