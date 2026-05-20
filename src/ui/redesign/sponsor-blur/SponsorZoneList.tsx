import type { CSSProperties } from "react";

import type { BlurZone } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./SponsorBlurPage.module.css";

interface SponsorZoneListProps {
  zones: BlurZone[];
  selectedId: string | null;
  getZoneName: (zone: BlurZone, index: number) => string;
  onSelectZone: (id: string) => void;
  onChangeZone: (id: string, patch: Partial<BlurZone>) => void;
}

const ZONE_COLORS = ["#8a48ff", "#42d94b", "#f3b33d", "#2d83ff", "#ff5f67", "#31d0c5"];

export function SponsorZoneList({
  zones,
  selectedId,
  getZoneName,
  onSelectZone,
  onChangeZone,
}: SponsorZoneListProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Зоны ({zones.length})</div>
        <RedesignIcon name="blur" />
      </div>
      <div className={`${styles.panelBody} ${styles.list}`}>
        {zones.length === 0 ? (
          <div className={styles.statusBox}>Зон пока нет. Добавьте область поверх кадра.</div>
        ) : (
          zones.map((zone, index) => (
            <button
              key={zone.id}
              type="button"
              className={`${styles.zoneRow} ${selectedId === zone.id ? styles.zoneRowActive : ""}`}
              style={{ "--zone-color": ZONE_COLORS[index % ZONE_COLORS.length] } as CSSProperties}
              onClick={() => onSelectZone(zone.id)}
            >
              <span className={styles.swatch} />
              <span className={styles.zoneRowText}>
                <span className={styles.zoneRowName}>{getZoneName(zone, index)}</span>
                <span className={styles.zoneRowMeta}>
                  {effectLabel(zone.effect)} · {Math.round(zone.x)}, {Math.round(zone.y)} · {Math.round(zone.width)}x{Math.round(zone.height)}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                title={zone.enabled ? "Скрыть зону" : "Показать зону"}
                onClick={(event) => {
                  event.stopPropagation();
                  onChangeZone(zone.id, { enabled: !zone.enabled });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onChangeZone(zone.id, { enabled: !zone.enabled });
                }}
              >
                <RedesignIcon name={zone.enabled ? "visible" : "hidden"} />
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function effectLabel(effect: BlurZone["effect"]) {
  if (effect === "gaussian_blur") return "Блюр";
  if (effect === "image_overlay") return "Image";
  return "Mosaic";
}
