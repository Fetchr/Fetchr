import { formatDuration } from "@/lib/format";
import type { Quality, ResolvedStream } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./AddTaskModal.module.css";
import { AddTaskPresetSummary } from "./AddTaskPresetSummary";
import { TimecodeRangeList, type TimecodeRange } from "./TimecodeRangeList";

export interface AddTaskFormProps {
  sourceUrl: string;
  fileName: string;
  quality: string;
  downloadFolder: string;
  start: string;
  end: string;
  ranges: TimecodeRange[];
  downloadChatEnabled: boolean;
  sponsorBlurEnabled: boolean;
  additionalOpen: boolean;
  analyzing: boolean;
  error: string | null;
  resolved: ResolvedStream | null;
  previewUrl: string | null;
  previewEmbedUrl: string | null;
  previewLoading: boolean;
  previewError: string | null;
  presetName: string;
  sourceLabel: string;
  qualityOptions: Quality[];
  m3u8VideoOnly: boolean;
  chatPresets: Array<{ id: string; name: string }>;
  activeChatPresetId: string;
  sponsorBlurPresets: Array<{ id: string; name: string }>;
  activeSponsorPresetId: string;
  onSourceUrlChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onDownloadFolderChange: (value: string) => void;
  onChooseFolder: () => void;
  onPasteSource: () => void;
  onAnalyze: () => void;
  onDownloadChatChange: (value: boolean) => void;
  onChatPresetChange: (presetId: string) => void;
  onSponsorBlurChange: (value: boolean) => void;
  onSponsorPresetChange: (presetId: string) => void;
  onConfigureBlur: () => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAddRange: () => void;
  onUpdateRange: (id: string, patch: Partial<Pick<TimecodeRange, "start" | "end">>) => void;
  onRemoveRange: (id: string) => void;
}

export function AddTaskForm({
  sourceUrl,
  fileName,
  quality,
  downloadFolder,
  start,
  end,
  ranges,
  downloadChatEnabled,
  sponsorBlurEnabled,
  additionalOpen,
  analyzing,
  error,
  resolved,
  previewUrl,
  previewEmbedUrl,
  previewLoading,
  previewError,
  presetName,
  sourceLabel,
  qualityOptions,
  m3u8VideoOnly,
  chatPresets,
  activeChatPresetId,
  sponsorBlurPresets,
  activeSponsorPresetId,
  onSourceUrlChange,
  onFileNameChange,
  onQualityChange,
  onDownloadFolderChange,
  onChooseFolder,
  onPasteSource,
  onAnalyze,
  onDownloadChatChange,
  onChatPresetChange,
  onSponsorBlurChange,
  onSponsorPresetChange,
  onConfigureBlur,
  onStartChange,
  onEndChange,
  onAddRange,
  onUpdateRange,
  onRemoveRange,
}: AddTaskFormProps) {
  const qualityLabel =
    quality === "best"
      ? "Лучшее доступное (оригинал)"
      : qualityOptions.find((item) => item.id === quality)?.label ?? quality;
  const transportLabel = isTwitchVodSource(sourceUrl)
    ? "Видео: m3u8/HLS · Чат: Twitch VOD"
    : m3u8VideoOnly
      ? "Видео: m3u8/HLS · Чат: недоступен"
      : null;

  return (
    <div className={styles.grid}>
      <div className={styles.form}>
        <section className={`${styles.section} ${styles.sourceSection}`}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <RedesignIcon name="link" className="size-[16px]" />
              Источник
            </div>
            <button className={`${styles.primaryButton} ${styles.analyzeButton}`} type="button" onClick={onAnalyze} disabled={!sourceUrl.trim() || analyzing}>
              <RedesignIcon name={analyzing ? "loading" : "finder"} className="size-[15px]" />
              Проанализировать
            </button>
          </div>

          <div className={styles.fieldRow}>
            <input
              className={styles.input}
              value={sourceUrl}
              onChange={(event) => onSourceUrlChange(event.currentTarget.value)}
              placeholder="https://www.twitch.tv/username или https://www.twitch.tv/videos/123456789"
            />
            <button className={styles.button} type="button" onClick={onPasteSource}>
              <RedesignIcon name="clipboard" className="size-[15px]" />
              Вставить
            </button>
          </div>
          <div className={styles.hint}>
            {sourceLabel}. Поддерживаются ссылки на канал, видео, трансляцию и клипы.
            {m3u8VideoOnly ? " m3u8 добавляется как video-only источник без чата." : ""}
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {resolved && (
            <div className={styles.analysisCompact}>
              <div className={styles.analysisTitle}>{resolved.title ?? "Источник распознан"}</div>
              <div className={styles.analysisMeta}>
                {resolved.uploader ?? sourceLabel} · {resolved.is_live ? "Live" : "VOD"} ·{" "}
                {resolved.duration ? formatDuration(resolved.duration) : "длительность неизвестна"} ·{" "}
                {resolved.qualities.length} качеств
              </div>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.compactFields}>
            <label className={styles.compactField}>
              <span>Название файла</span>
              <input
                className={styles.input}
                value={fileName}
                onChange={(event) => onFileNameChange(event.currentTarget.value)}
                placeholder="Имя файла без расширения"
              />
            </label>

            <label className={styles.compactField}>
              <span>Качество</span>
              <div className={styles.qualityRow}>
                <select className={styles.select} value={quality} onChange={(event) => onQualityChange(event.currentTarget.value)}>
                  <option value="best">Лучшее доступное (оригинал)</option>
                  {qualityOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatQuality(item)}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className={`${styles.compactField} ${styles.folderField}`}>
              <span>Папка сохранения</span>
              <div className={styles.folderRow}>
                <input
                  className={styles.input}
                  value={downloadFolder}
                  onChange={(event) => onDownloadFolderChange(event.currentTarget.value)}
                  placeholder="C:\\Users\\..."
                />
                <button className={styles.iconButton} type="button" aria-label="Выбрать папку" onClick={onChooseFolder}>
                  <RedesignIcon name="more" className="size-[15px]" />
                </button>
              </div>
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <RedesignIcon name="time" className="size-[16px]" />
              Клипы / таймкоды
            </div>
            <span className={styles.sectionMeta}>{ranges.length ? `${ranges.length} диапаз.` : "single range"}</span>
          </div>
          <TimecodeRangeList
            start={start}
            end={end}
            ranges={ranges}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onAddRange={onAddRange}
            onUpdateRange={onUpdateRange}
            onRemoveRange={onRemoveRange}
          />
        </section>

        <section className={styles.section}>
          <div className={styles.toggleGrid}>
            <label className={styles.toggleLabel}>
              <input
                className={styles.toggle}
                type="checkbox"
                checked={downloadChatEnabled && !m3u8VideoOnly}
                disabled={m3u8VideoOnly}
                onChange={(event) => onDownloadChatChange(event.currentTarget.checked)}
              />
              <RedesignIcon name="chat" className="size-[16px]" />
              Добавить чат
            </label>
            <select
              className={styles.select}
              value={activeChatPresetId}
              onChange={(event) => onChatPresetChange(event.currentTarget.value)}
              disabled={!downloadChatEnabled || m3u8VideoOnly || chatPresets.length === 0}
            >
              {chatPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <span className={styles.toggleHint}>
              {m3u8VideoOnly ? "m3u8 video-only без чата" : "Twitch/Kick чат будет скачан с выбранным пресетом"}
            </span>
          </div>

          <div className={`${styles.toggleGrid} ${styles.toggleGridStacked}`}>
            <label className={styles.toggleLabel}>
              <input
                className={styles.toggle}
                type="checkbox"
                checked={sponsorBlurEnabled}
                onChange={(event) => onSponsorBlurChange(event.currentTarget.checked)}
              />
              <RedesignIcon name="blur" className="size-[16px]" />
              Блюр спонсоров
            </label>
            <select
              className={styles.select}
              value={activeSponsorPresetId}
              onChange={(event) => onSponsorPresetChange(event.currentTarget.value)}
              disabled={!sponsorBlurEnabled || sponsorBlurPresets.length === 0}
            >
              {sponsorBlurPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button className={styles.button} type="button" onClick={onConfigureBlur}>
              <RedesignIcon name="settings" className="size-[15px]" />
              Настроить блюр
            </button>
          </div>
        </section>

        {additionalOpen && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              <RedesignIcon name="settings" className="size-[16px]" />
              Дополнительные настройки
            </div>
            <div className={styles.hint}>
              Для m3u8 источников задача создаётся как video-only HLS, если приложение не получило отдельный источник чата.
              Download-логика и схема задания остаются существующими.
            </div>
          </section>
        )}

      </div>

      <AddTaskPresetSummary
        presetName={presetName}
        sourceLabel={sourceLabel}
        qualityLabel={qualityLabel}
        transportLabel={transportLabel}
        folder={downloadFolder}
        sponsorBlurEnabled={sponsorBlurEnabled}
        rangeCount={ranges.length}
        resolved={resolved}
        previewUrl={previewUrl}
        previewEmbedUrl={previewEmbedUrl}
        previewLoading={previewLoading}
        previewError={previewError}
        onMarkStart={onStartChange}
        onMarkEnd={onEndChange}
      />
    </div>
  );
}

function isTwitchVodSource(input: string): boolean {
  return /(?:^https?:\/\/)?(?:www\.)?twitch\.tv\/(?:videos|video|v)\/\d+/i.test(input.trim());
}

function formatQuality(quality: Quality): string {
  const parts = [quality.label];
  if (quality.ext) parts.push(quality.ext);
  if (quality.has_video && !quality.has_audio) parts.push("без звука");
  return parts.join(" · ");
}
