import type { TwitchPublicVod, TwitchPublicVodPage } from "@/services/m3u8/m3u8DiscoveryTypes";
import { PlatformIcon, RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { RemoteImage } from "@/ui/redesign/media/RemoteImage";

import styles from "./M3U8FinderPage.module.css";

export interface FinderStreamRow {
  id: string;
  kind: "public" | "tracker";
  title: string;
  username: string;
  streamId: string | null;
  createdAt: string | null;
  duration: string;
  thumbnailUrl: string | null;
  twitchUrl: string | null;
  trackerUrl: string | null;
  chatAvailable: boolean;
  publicVod?: TwitchPublicVod;
}

interface VodResultsTableProps {
  page?: TwitchPublicVodPage | null;
  rows?: FinderStreamRow[];
  loading: boolean;
  copiedId?: string | null;
  queuedId?: string | null;
  generatingId?: string | null;
  streamPage: number;
  totalStreams: number;
  pageSize: number;
  trackerError?: string | null;
  onCopyPublic: (vod: TwitchPublicVod) => void;
  onAddPublicToQueue: (vod: TwitchPublicVod) => void;
  onCopyRecovered: (row: FinderStreamRow) => void;
  onAddRecoveredToQueue: (row: FinderStreamRow) => void;
  onPageChange: (page: number) => void;
}

export function VodResultsTable({
  page,
  rows,
  loading,
  copiedId,
  queuedId,
  generatingId,
  streamPage,
  totalStreams,
  pageSize,
  trackerError,
  onCopyPublic,
  onAddPublicToQueue,
  onCopyRecovered,
  onAddRecoveredToQueue,
  onPageChange,
}: VodResultsTableProps) {
  const items = rows ?? (page?.items ?? []).slice(0, pageSize).map(publicVodToRow);
  const totalPages = Math.max(1, Math.ceil(Math.max(totalStreams || items.length, items.length) / pageSize));
  const canPrev = streamPage > 1 && !loading;
  const canNext = streamPage < totalPages && !loading;

  return (
    <section className={`${styles.panel} ${styles.tablePanel}`}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <PlatformIcon platform="twitch" />
          </span>
          <div>
            <div className={styles.panelTitle}>Стримы Twitch</div>
            <div className={styles.panelSubtitle}>
              {page || rows ? `Показано: ${items.length} из ${totalStreams || items.length}` : "Загрузите список по никнейму"}
            </div>
          </div>
        </div>
      </div>

      {trackerError && <div className={styles.tableNotice}>Tracker список недоступен: {trackerError}</div>}

      <div className={styles.tableScroll}>
        <div className={styles.vodTable}>
          <div className={styles.vodHeader}>
            <span>Превью</span>
            <span>Стрим</span>
            <span>Дата / длит.</span>
            <span>Тип</span>
            <span>Действия</span>
          </div>

          {items.length === 0 ? (
            <div className={styles.empty}>
              {loading ? "Загружаем список стримов..." : "Стримы пока не загружены."}
            </div>
          ) : (
            items.map((row) => {
              const isPublic = row.kind === "public" && row.publicVod;
              const busy = generatingId === row.id;

              return (
                <div className={styles.vodRow} key={row.id}>
                  <RemoteImage
                    className={styles.thumbnail}
                    src={row.thumbnailUrl}
                    alt={row.title}
                    fallbackLabel={row.kind === "public" ? "Twitch VOD" : "Hidden VOD"}
                    platform="twitch"
                    aspectRatio="16 / 9"
                  />
                  <div className={styles.titleCell}>
                    <div className={styles.mainText}>{row.title}</div>
                    <div className={styles.subText}>
                      {row.username}
                      {row.streamId ? ` · stream_id: ${row.streamId}` : ""}
                    </div>
                    <div className={styles.subText}>{isPublic ? row.twitchUrl : row.trackerUrl}</div>
                  </div>
                  <div className={styles.compactMetaCell}>
                    <span>{formatVodDate(row.createdAt)}</span>
                    <span>{row.duration || "-"}</span>
                  </div>
                  <span className={`${styles.badge} ${isPublic ? styles.successBadge : styles.warningBadge}`}>
                    {isPublic ? "Public" : "m3u8"}
                  </span>
                  <div className={styles.rowActions}>
                    <button
                      className={`${styles.button} ${styles.smallButton}`}
                      type="button"
                      onClick={() => isPublic ? onCopyPublic(row.publicVod!) : onCopyRecovered(row)}
                      disabled={!isPublic && (!row.streamId || busy)}
                      title={isPublic ? "Скопировать Twitch VOD URL" : "Найти и скопировать recovered m3u8"}
                    >
                      <RedesignIcon name={copiedId === row.id ? "check" : busy ? "loading" : "copy"} className={busy ? "animate-spin" : undefined} />
                      {copiedId === row.id ? "Готово" : isPublic ? "Twitch URL" : "m3u8"}
                    </button>
                    <button
                      className={`${styles.button} ${styles.smallButton} ${styles.primaryButton}`}
                      type="button"
                      onClick={() => isPublic ? onAddPublicToQueue(row.publicVod!) : onAddRecoveredToQueue(row)}
                      disabled={!isPublic && (!row.streamId || busy)}
                    >
                      <RedesignIcon name={queuedId === row.id ? "check" : busy ? "loading" : "add"} className={busy ? "animate-spin" : undefined} />
                      {queuedId === row.id ? "В очереди" : "Добавить"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className={styles.tableFooter}>
        <span>Public копирует Twitch VOD URL для чата. m3u8 генерируется только для скрытых/удалённых.</span>
        <div className={styles.pagination}>
          <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={() => onPageChange(streamPage - 1)} disabled={!canPrev}>
            <RedesignIcon name="chevronDown" className={styles.prevIcon} />
          </button>
          <span className={styles.pageCounter}>{streamPage} / {totalPages}</span>
          <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={() => onPageChange(streamPage + 1)} disabled={!canNext}>
            <RedesignIcon name="chevronDown" className={styles.nextIcon} />
          </button>
        </div>
      </div>
    </section>
  );
}

function publicVodToRow(vod: TwitchPublicVod): FinderStreamRow {
  return {
    id: `public:${vod.id}`,
    kind: "public",
    title: vod.title || `Twitch VOD ${vod.id}`,
    username: "twitch",
    streamId: vod.streamId,
    createdAt: vod.createdAt,
    duration: vod.duration || "-",
    thumbnailUrl: vod.thumbnailUrl,
    twitchUrl: vod.url,
    trackerUrl: null,
    chatAvailable: vod.chatAvailable,
    publicVod: vod,
  };
}

function formatVodDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
