import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";

export type FrameSourceMode = "url" | "frame";

interface ChatFrameSourceCardProps {
  mode: FrameSourceMode;
  screenshotUrl: string;
  loading: boolean;
  error?: string | null;
  onModeChange: (mode: FrameSourceMode) => void;
  onScreenshotUrlChange: (value: string) => void;
  onPaste: () => void;
  onUpdatePreview: () => void;
}

export function ChatFrameSourceCard({
  mode,
  screenshotUrl,
  loading,
  error,
  onModeChange,
  onScreenshotUrlChange,
  onPaste,
  onUpdatePreview,
}: ChatFrameSourceCardProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Источник кадра</div>
        <RedesignIcon name="image" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <div className={styles.segmented}>
            <button className={`${styles.segment} ${mode === "url" ? styles.segmentActive : ""}`} type="button" onClick={() => onModeChange("url")}>
              Ссылка на скрин
            </button>
            <button className={`${styles.segment} ${mode === "frame" ? styles.segmentActive : ""}`} type="button" onClick={() => onModeChange("frame")}>
              Кадр из видео
            </button>
          </div>

          {mode === "url" ? (
            <label className={styles.field}>
              <span className={styles.label}>URL скриншота</span>
              <div className={styles.twoColumn} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <input
                  className={`${styles.input} ${styles.mono}`}
                  value={screenshotUrl}
                  placeholder="https://example.com/screenshot.png"
                  onChange={(event) => onScreenshotUrlChange(event.target.value)}
                />
                <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onPaste} title="Вставить">
                  <RedesignIcon name="clipboard" />
                </button>
              </div>
            </label>
          ) : (
            <p className={styles.hint}>Кадр будет извлечён из указанного Twitch/Kick VOD URL с учётом начала диапазона.</p>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onUpdatePreview} disabled={loading}>
            <RedesignIcon name={loading ? "loading" : "refresh"} className={loading ? "animate-spin" : undefined} />
            Обновить превью
          </button>
        </div>
      </div>
    </section>
  );
}
