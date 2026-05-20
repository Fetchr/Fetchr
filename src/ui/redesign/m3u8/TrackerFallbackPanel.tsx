import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./M3U8FinderPage.module.css";

interface TrackerFallbackPanelProps {
  sourceUrl: string;
  loading: boolean;
  error?: string | null;
  onSourceUrlChange: (value: string) => void;
  onPaste: () => void;
  onFetchMetadata: () => void;
}

export function TrackerFallbackPanel({
  sourceUrl,
  loading,
  error,
  onSourceUrlChange,
  onPaste,
  onFetchMetadata,
}: TrackerFallbackPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <RedesignIcon name="source" />
          </span>
          <div>
            <div className={styles.panelTitle}>Tracker fallback</div>
            <div className={styles.panelSubtitle}>TwitchTracker / StreamCharts / SullyGnome</div>
          </div>
        </div>
      </div>

      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>Tracker URL</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={sourceUrl}
                placeholder="Вставьте ссылку на twitchtracker / streamscharts / sullygnome"
                onChange={(event) => onSourceUrlChange(event.target.value)}
              />
            </label>
            <div className={styles.trackerActions}>
              <button
                className={`${styles.button} ${styles.iconButton}`}
                type="button"
                onClick={onPaste}
                title="Вставить"
                aria-label="Вставить"
              >
                <RedesignIcon name="clipboard" />
              </button>
              <button
                className={`${styles.button} ${styles.iconButton}`}
                type="button"
                onClick={onFetchMetadata}
                disabled={!sourceUrl.trim() || loading}
                title="Подтянуть"
                aria-label="Подтянуть"
              >
                <RedesignIcon name={loading ? "loading" : "external"} className={loading ? "animate-spin" : undefined} />
              </button>
            </div>
          </div>

          <p className={styles.hint}>
            Tracker используется только как источник метаданных. Recovered m3u8 добавляется как video-only HLS задача.
          </p>

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>
      </div>
    </section>
  );
}
