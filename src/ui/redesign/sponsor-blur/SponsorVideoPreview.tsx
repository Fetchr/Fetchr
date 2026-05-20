import { LocalImage } from "@/components/local-image";
import type { BlurZone } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { RemoteImage } from "@/ui/redesign/media/RemoteImage";

import styles from "./SponsorBlurPage.module.css";
import { SponsorZoneOverlay } from "./SponsorZoneOverlay";

export interface SponsorPreviewSource {
  kind: "local" | "url";
  src: string;
}

interface SponsorVideoPreviewProps {
  preview: SponsorPreviewSource | null;
  zones: BlurZone[];
  selectedId: string | null;
  showZones: boolean;
  showGrid: boolean;
  frameTime: number | null;
  loading: boolean;
  error: string | null;
  getZoneName: (zone: BlurZone, index: number) => string;
  onSelectZone: (id: string) => void;
  onChangeZone: (id: string, patch: Partial<BlurZone>) => void;
}

export function SponsorVideoPreview({
  preview,
  zones,
  selectedId,
  showZones,
  showGrid,
  frameTime,
  loading,
  error,
  getZoneName,
  onSelectZone,
  onChangeZone,
}: SponsorVideoPreviewProps) {
  return (
    <section className={`${styles.panel} ${styles.previewPanel}`}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <RedesignIcon name="preview" />
          Предпросмотр кадра
        </div>
        <span className={styles.mono}>1920x1080</span>
      </div>
      <div className={styles.panelBody}>
        <SponsorZoneOverlay
          zones={zones}
          selectedId={selectedId}
          showZones={showZones}
          showGrid={showGrid}
          getZoneName={getZoneName}
          onSelectZone={onSelectZone}
          onChangeZone={onChangeZone}
        >
          {preview ? (
            preview.kind === "local" ? (
              <LocalImage path={preview.src} className={styles.previewImage} draggable={false} />
            ) : (
              <RemoteImage
                src={preview.src}
                alt="Reference frame"
                fallbackLabel="Кадр"
                className={styles.previewImage}
              />
            )
          ) : (
            <div className={styles.emptyPreview}>
              {loading ? "Извлекаем кадр..." : "Выберите видео, извлеките кадр или укажите reference URL"}
            </div>
          )}
          <div className={styles.frameMeta}>
            <span>{loading ? "loading" : frameTime == null ? "00:00:00" : formatTime(frameTime)}</span>
            <span>{zones.filter((zone) => zone.enabled).length} blur zones</span>
          </div>
        </SponsorZoneOverlay>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </section>
  );
}

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
