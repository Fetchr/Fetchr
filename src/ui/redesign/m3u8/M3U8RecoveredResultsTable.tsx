import { RECOVERED_M3U8_CHAT_WARNING } from "@/services/m3u8/m3u8DiscoveryTypes";
import { PlatformIcon, RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./M3U8FinderPage.module.css";

export interface M3U8RecoveredResultRow {
  url: string;
  bitrate: string;
  resolution: string;
  duration: string;
  status: string;
  copied?: boolean;
}

interface M3U8RecoveredResultsTableProps {
  rows: M3U8RecoveredResultRow[];
  loading: boolean;
  tried: number;
  queuedUrl?: string | null;
  onCopy: (index: number) => void;
  onAddVideoOnlyTask: (url: string) => void;
  onRefresh: () => void;
  canRefresh: boolean;
}

export function M3U8RecoveredResultsTable({
  rows,
  loading,
  tried,
  queuedUrl,
  onCopy,
  onAddVideoOnlyTask,
  onRefresh,
  canRefresh,
}: M3U8RecoveredResultsTableProps) {
  return (
    <section className={`${styles.panel} ${styles.tablePanel}`}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <PlatformIcon platform="hls" />
          </span>
          <div>
            <div className={styles.panelTitle}>Найденные m3u8 плейлисты</div>
            <div className={styles.panelSubtitle}>
              {tried > 0 ? `Проверено вариантов: ${tried}` : "Recovered HLS fallback"}
            </div>
          </div>
        </div>
        <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={onRefresh} disabled={!canRefresh || loading}>
          <RedesignIcon name={loading ? "loading" : "refresh"} className={loading ? "animate-spin" : undefined} />
          Обновить
        </button>
      </div>

      <div className={styles.warningBox}>Recovered m3u8 не содержит чат. {RECOVERED_M3U8_CHAT_WARNING}</div>

      <div className={styles.tableScroll}>
        <div className={styles.recoveredTable}>
          <div className={styles.recoveredHeader}>
            <span>m3u8 URL</span>
            <span>Параметры</span>
            <span>Статус</span>
            <span>Действия</span>
          </div>

          {rows.length === 0 ? (
            <div className={styles.empty}>
              {loading ? "Ищем публично доступные HLS плейлисты..." : "Найденные recovered m3u8 появятся здесь."}
            </div>
          ) : (
            rows.map((row, index) => (
              <div className={styles.recoveredRow} key={row.url}>
                <div className={styles.urlCell}>
                  <div className={styles.mainText}>HLS playlist</div>
                  <div className={styles.subText}>{row.url}</div>
                </div>
                <div className={styles.compactMetaCell}>
                  <span>{row.bitrate}</span>
                  <span>{row.resolution}</span>
                  <span>{row.duration}</span>
                </div>
                <span className={`${styles.badge} ${styles.successBadge}`}>{row.status}</span>
                <div className={styles.rowActions}>
                  <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={() => onCopy(index)}>
                    <RedesignIcon name={row.copied ? "check" : "copy"} />
                    {row.copied ? "Готово" : "m3u8"}
                  </button>
                  <button
                    className={`${styles.button} ${styles.smallButton} ${styles.primaryButton}`}
                    type="button"
                    onClick={() => onAddVideoOnlyTask(row.url)}
                  >
                    <RedesignIcon name={queuedUrl === row.url ? "check" : "add"} />
                    {queuedUrl === row.url ? "В очереди" : "Добавить"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.tableFooter}>
        <span>Recovered m3u8 добавляется как video-only HLS задача, чат отключён.</span>
        <span>Найдено плейлистов: {rows.length}</span>
      </div>
    </section>
  );
}
