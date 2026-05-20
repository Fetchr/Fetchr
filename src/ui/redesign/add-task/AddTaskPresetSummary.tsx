import { useRef } from "react";

import { HlsPlayer, type HlsPlayerHandle } from "@/components/hls-player";
import { formatDuration } from "@/lib/format";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { RemoteImage } from "@/ui/redesign/media/RemoteImage";
import type { ResolvedStream } from "@/types/job";

import styles from "./AddTaskModal.module.css";

export interface AddTaskPresetSummaryProps {
  presetName: string;
  sourceLabel: string;
  qualityLabel: string;
  transportLabel?: string | null;
  folder: string;
  sponsorBlurEnabled: boolean;
  rangeCount: number;
  resolved: ResolvedStream | null;
  previewUrl: string | null;
  previewEmbedUrl: string | null;
  previewLoading: boolean;
  previewError: string | null;
  onMarkStart: (value: string) => void;
  onMarkEnd: (value: string) => void;
}

export function AddTaskPresetSummary({
  presetName,
  sourceLabel,
  qualityLabel,
  transportLabel,
  folder,
  sponsorBlurEnabled,
  rangeCount,
  resolved,
  previewUrl,
  previewEmbedUrl,
  previewLoading,
  previewError,
  onMarkStart,
  onMarkEnd,
}: AddTaskPresetSummaryProps) {
  const playerRef = useRef<HlsPlayerHandle | null>(null);
  const canMarkTime = Boolean(previewUrl);

  const mark = (target: "start" | "end") => {
    const seconds = playerRef.current?.getCurrentTime() ?? 0;
    const value = formatTimecode(seconds);
    if (target === "start") onMarkStart(value);
    else onMarkEnd(value);
  };

  return (
    <aside className={styles.summaryCard} aria-label="Сводка задачи">
      <div className={styles.summaryHeader}>
        <div>
          <div className={styles.summaryTitle}>Пресет</div>
          <div className={styles.presetName}>{presetName}</div>
        </div>
        <span className={styles.summaryPlatform}>{sourceLabel}</span>
      </div>

      <div className={styles.mediaPreview}>
        {previewEmbedUrl ? (
          <iframe
            className={styles.previewFrame}
            src={previewEmbedUrl}
            title={resolved?.title ?? "Preview"}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : previewUrl ? (
          <HlsPlayer ref={playerRef} src={previewUrl} className={styles.previewPlayerLarge} />
        ) : (
          <RemoteImage
            src={resolved?.thumbnail}
            alt={resolved?.title ?? sourceLabel}
            fallbackLabel={resolved?.platform || sourceLabel}
            platform={resolved?.platform}
            aspectRatio="16 / 9"
          />
        )}
        {previewLoading && (
          <div className={styles.previewOverlay}>
            <RedesignIcon name="loading" className="size-[16px]" />
            Загрузка предпросмотра...
          </div>
        )}
      </div>

      <div className={styles.markButtons}>
        <button className={styles.button} type="button" onClick={() => mark("start")} disabled={!canMarkTime}>
          <RedesignIcon name="time" className="size-[15px]" />
          Начало
        </button>
        <button className={styles.button} type="button" onClick={() => mark("end")} disabled={!canMarkTime}>
          <RedesignIcon name="time" className="size-[15px]" />
          Конец
        </button>
      </div>

      {previewError && <div className={styles.previewError}>{previewError}</div>}

      <div className={styles.summaryList}>
        <SummaryRow label="Источник" value={sourceLabel} />
        {transportLabel && <SummaryRow label="Потоки" value={transportLabel} />}
        <SummaryRow label="Качество" value={qualityLabel} />
        <SummaryRow label="Папка" value={folder || "Не выбрана"} />
        <SummaryRow label="Блюр спонсоров" value={sponsorBlurEnabled ? "Включен" : "Отключен"} />
        <SummaryRow label="Клипы" value={rangeCount > 0 ? `${rangeCount} диапаз.` : "single range"} />
        <SummaryRow
          label="Длительность"
          value={resolved?.duration ? formatDuration(resolved.duration) : "—"}
        />
      </div>

      <div className={styles.hint}>
        <RedesignIcon name="info" className="mr-1 inline size-[13px]" />
        После анализа preview станет медиаплеером, если источник поддерживает поток предпросмотра.
      </div>
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryRow}>
      <span>{label}</span>
      <span className={styles.summaryValue} title={value}>
        {value}
      </span>
    </div>
  );
}

function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}
