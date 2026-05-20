import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./M3U8FinderPage.module.css";

export interface M3U8AnalysisStats {
  publicVodCount: number;
  checkedCandidates: number;
  recoveredCount: number;
  queueReadyCount: number;
  errorCount: number;
}

export interface M3U8AnalysisStep {
  title: string;
  detail: string;
  done: boolean;
  active?: boolean;
}

interface M3U8AnalysisStatusProps {
  stats: M3U8AnalysisStats;
  steps: M3U8AnalysisStep[];
}

export function M3U8AnalysisStatus({ stats, steps }: M3U8AnalysisStatusProps) {
  return (
    <aside className={styles.statusPanel}>
      <section className={`${styles.panel} ${styles.statusCard}`}>
        <h2 className={styles.statusTitle}>Сводка анализа</h2>
        <div className={styles.statList}>
          <Stat label="Публичных VOD" value={stats.publicVodCount} />
          <Stat label="Проверено вариантов" value={stats.checkedCandidates} />
          <Stat label="Найдено плейлистов" value={stats.recoveredCount} />
          <Stat label="Готово к скачиванию" value={stats.queueReadyCount} />
          <Stat label="Ошибок" value={stats.errorCount} />
        </div>
      </section>

      <section className={`${styles.panel} ${styles.statusCard}`}>
        <h2 className={styles.statusTitle}>Статус</h2>
        <div className={styles.statusList}>
          {steps.map((step) => (
            <div className={styles.statusItem} key={step.title}>
              <span
                className={[
                  styles.statusIcon,
                  step.done ? styles.statusDone : "",
                  step.active ? styles.statusActive : "",
                ].join(" ")}
              >
                <RedesignIcon name={step.active ? "loading" : step.done ? "check" : "time"} className={step.active ? "animate-spin" : undefined} />
              </span>
              <span className={styles.statusText}>
                <span className={styles.statusName}>{step.title}</span>
                <span className={styles.statusDetail}>{step.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.statusCard}`}>
        <h2 className={styles.statusTitle}>Правило чата</h2>
        <p className={styles.hint}>
          Чат доступен только для задач с прямой Twitch VOD ссылкой. Recovered m3u8 всегда video-only.
        </p>
      </section>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.statRow}>
      <span>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
