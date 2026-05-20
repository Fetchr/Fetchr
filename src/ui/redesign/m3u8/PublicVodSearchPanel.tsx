import type { TwitchPublicVodPage } from "@/services/m3u8/m3u8DiscoveryTypes";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { RemoteImage } from "@/ui/redesign/media/RemoteImage";

import styles from "./M3U8FinderPage.module.css";

interface PublicVodSearchPanelProps {
  login: string;
  loading: boolean;
  error?: string | null;
  page?: TwitchPublicVodPage | null;
  presetName?: string | null;
  presetHistory?: string[];
  onLoginChange: (value: string) => void;
  onSearch: () => void;
  onSavePreset?: () => void;
  onReloadPreset?: () => void;
}

export function PublicVodSearchPanel({
  login,
  loading,
  error,
  page,
  presetName,
  presetHistory = [],
  onLoginChange,
  onSearch,
  onSavePreset,
  onReloadPreset,
}: PublicVodSearchPanelProps) {
  const broadcaster = page?.broadcaster;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <RedesignIcon name="live" />
          </span>
          <div>
            <div className={styles.panelTitle}>Поиск сохранённых стримов по нику Twitch</div>
            <div className={styles.panelSubtitle}>{presetName ? `Пресет: ${presetName}` : "Публичный VOD режим"}</div>
          </div>
        </div>
        <div className={styles.panelActions}>
          {onReloadPreset && (
            <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onReloadPreset} title="Перезагрузить пресет" disabled={loading}>
              <RedesignIcon name={loading ? "loading" : "refresh"} className={loading ? "animate-spin" : undefined} />
            </button>
          )}
          {onSavePreset && (
            <button className={styles.button} type="button" onClick={onSavePreset} disabled={!login.trim()}>
              <RedesignIcon name="save" />
              Сохранить
            </button>
          )}
        </div>
      </div>

      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>Никнейм</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={login}
                placeholder="Например: riotgames"
                onChange={(event) => onLoginChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) onSearch();
                }}
              />
            </label>
            <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onSearch} disabled={loading}>
              <RedesignIcon name={loading ? "loading" : "download"} className={loading ? "animate-spin" : undefined} />
              Загрузить VOD
            </button>
          </div>

          <p className={styles.hint}>
            Для задач с чатом используйте прямую Twitch VOD ссылку из публичного списка. Для удалённых стримов генерируется video-only m3u8.
          </p>

          {presetHistory.length > 0 && (
            <div className={styles.historyRow}>
              {presetHistory.slice(0, 6).map((item) => (
                <button className={styles.historyChip} type="button" key={item} onClick={() => onLoginChange(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        {broadcaster && (
          <div className={styles.profileStrip}>
            <RemoteImage
              className={styles.avatar}
              src={broadcaster.profileImageUrl}
              alt={broadcaster.displayName}
              fallbackLabel={broadcaster.displayName || broadcaster.login}
              platform="twitch"
              platformBadge=""
              aspectRatio="1 / 1"
            />
            <div className={styles.profileText}>
              <div className={styles.profileName}>{broadcaster.displayName}</div>
              <div className={styles.profileMeta}>@{broadcaster.login} · ID {broadcaster.id}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
