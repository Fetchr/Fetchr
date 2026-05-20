import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./M3U8FinderPage.module.css";

interface M3U8SearchParamsCardProps {
  username: string;
  streamId: string;
  startTime: string;
  candidates: string[];
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onStreamIdChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onSearch: () => void;
}

export function M3U8SearchParamsCard({
  username,
  streamId,
  startTime,
  candidates,
  loading,
  onUsernameChange,
  onStreamIdChange,
  onStartTimeChange,
  onSearch,
}: M3U8SearchParamsCardProps) {
  const disabled = !username.trim() || !streamId.trim() || !startTime.trim() || loading;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <RedesignIcon name="time" />
          </span>
          <div>
            <div className={styles.panelTitle}>Параметры поиска</div>
            <div className={styles.panelSubtitle}>Никнейм, stream ID и время начала</div>
          </div>
        </div>
      </div>

      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span className={styles.label}>Никнейм</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={username}
                placeholder="username"
                onChange={(event) => onUsernameChange(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Stream ID</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={streamId}
                placeholder="123456789"
                onChange={(event) => onStreamIdChange(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>Время начала</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={startTime}
                placeholder="2024-08-15 14:30"
                onChange={(event) => onStartTimeChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !disabled) onSearch();
                }}
              />
            </label>
            <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onSearch} disabled={disabled}>
              <RedesignIcon name={loading ? "loading" : "download"} className={loading ? "animate-spin" : undefined} />
              Найти m3u8
            </button>
          </div>

          <p className={styles.hint}>Пример: 2024-08-15 14:30, 14:30 сегодня, 15.08.2024 14:30, ISO 8601.</p>

          {candidates.length > 0 && (
            <div className={styles.candidateList}>
              {candidates.map((candidate) => (
                <button
                  className={styles.candidateButton}
                  key={candidate}
                  type="button"
                  onClick={() => onStartTimeChange(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
