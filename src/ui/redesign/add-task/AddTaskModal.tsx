import { useEffect, useMemo, useState } from "react";

import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import { defaultPerformanceSettings, useSettings } from "@/stores/settings";
import { defaultPresetRuntimeSettings, usePresets } from "@/stores/presets";
import { useWorkflowPresets } from "@/stores/workflowPresets";
import type { JobSpec, PreviewSource, ResolvedStream } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import { AddTaskForm } from "./AddTaskForm";
import styles from "./AddTaskModal.module.css";
import { SourceTabs, type AddTaskSource } from "./SourceTabs";
import type { TimecodeRange } from "./TimecodeRangeList";

export interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  onConfigureBlur?: () => void;
  onQueued?: () => void;
}

export function AddTaskModal({ open, onClose, onConfigureBlur, onQueued }: AddTaskModalProps) {
  const settings = useSettings();
  const presets = usePresets((state) => state.presets);
  const chatPresets = useWorkflowPresets((state) => state.chatPresets);
  const activeChatPresetId = useWorkflowPresets((state) => state.activeChatPresetId);
  const setActiveChatPreset = useWorkflowPresets((state) => state.setActiveChatPreset);
  const sponsorPresets = useWorkflowPresets((state) => state.sponsorPresets);
  const activeSponsorPresetId = useWorkflowPresets((state) => state.activeSponsorPresetId);
  const setActiveSponsorPreset = useWorkflowPresets((state) => state.setActiveSponsorPreset);
  const activePresetId = usePresets((state) => state.activePresetId);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const runtime = { ...defaultPresetRuntimeSettings, ...activePreset?.runtime };
  const [source, setSource] = useState<AddTaskSource>("twitch");
  const [sourceUrls, setSourceUrls] = useState<Record<AddTaskSource, string>>(() => createEmptySourceUrls());
  const [fileName, setFileName] = useState("");
  const [quality, setQuality] = useState(runtime.quality || "best");
  const [downloadFolder, setDownloadFolder] = useState(runtime.directory || settings.directory);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [ranges, setRanges] = useState<TimecodeRange[]>([]);
  const [downloadChatEnabled, setDownloadChatEnabled] = useState(Boolean(runtime.downloadChat));
  const [sponsorBlurEnabled, setSponsorBlurEnabled] = useState(Boolean(runtime.blurSponsors));
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewEmbedUrl, setPreviewEmbedUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (open) return;
    resetDraft();
  }, [open]);

  useEffect(() => {
    if (!open) {
      stopPreviewSession(previewSource);
    }
    return () => stopPreviewSession(previewSource);
  }, [open, previewSource]);

  const activeSource = source;
  const sourceUrl = sourceUrls[activeSource] ?? "";
  const sourceLabel = getSourceLabel(activeSource);
  const m3u8VideoOnly = activeSource === "m3u8";
  const qualityOptions = useMemo(() => {
    const options = (resolved?.qualities ?? []).filter((item) => item.has_video);
    return options;
  }, [resolved?.qualities]);
  const activeSponsorPreset = sponsorPresets.find((preset) => preset.id === activeSponsorPresetId) ?? sponsorPresets[0] ?? null;
  const activeChatPreset = chatPresets.find((preset) => preset.id === activeChatPresetId) ?? chatPresets[0] ?? null;
  const selectedQualityMeta =
    quality !== "best"
      ? qualityOptions.find((item) => item.id === quality) ?? null
      : null;

  if (!open) return null;

  const analyze = async () => {
    if (!sourceUrl.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await ipc.resolveStream(
        sourceUrl.trim(),
        { enabled: runtime.useProxy, url: runtime.proxyUrl || settings.proxy.url },
        settings.binariesDir,
      );
      setResolved(result);
      setSource(normalizeSource(result.platform));
      setQuality((current) => {
        const hasExactQuality = result.qualities.some((item) => item.id === current);
        return current === "best" || hasExactQuality ? current : "best";
      });
      if (!fileName.trim() && result.title) {
        setFileName(result.title.slice(0, 90));
      }
      void loadPreview(result);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (!sourceUrl.trim() || !downloadFolder.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const baseName = fileName.trim() || resolved?.title?.trim() || "Stream";
      const activeBlurZones = sponsorBlurEnabled
        ? (activeSponsorPreset?.zones.length ? activeSponsorPreset.zones : settings.blurZones).filter((zone) => zone.enabled)
        : [];
      const cleanRanges = ranges.filter((range) => range.start.trim() && range.end.trim());
      const shouldDownloadChat = downloadChatEnabled && !m3u8VideoOnly;
      const chatOverlay = activeChatPreset?.overlay ?? settings.chatOverlay;
      if (cleanRanges.length > 0) {
        for (const [index, range] of cleanRanges.entries()) {
          await StreamDownloader.enqueueWithChat(
            buildSpec({
              name: `${baseName}_clip${String(index + 1).padStart(2, "0")}`,
              start: range.start,
              end: range.end,
              blurZones: activeBlurZones,
            }),
            chatOverlay,
            shouldDownloadChat,
          );
        }
      } else {
        await StreamDownloader.enqueueWithChat(
          buildSpec({
            name: baseName,
            start: start.trim() || null,
            end: end.trim() || null,
            blurZones: activeBlurZones,
          }),
          chatOverlay,
          shouldDownloadChat,
        );
      }

      onQueued?.();
      resetAfterSubmit();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const buildSpec = ({
    name,
    start,
    end,
    blurZones,
  }: {
    name: string;
    start: string | null;
    end: string | null;
    blurZones: JobSpec["blur_zones"];
  }): JobSpec => ({
    url: sourceUrl.trim(),
    chat_source_url: twitchVodChatSourceUrl(sourceUrl),
    name,
    directory: downloadFolder.trim(),
    job_kind: "video",
    mode: activeSource === "rtmp" || resolved?.is_live ? "live" : "vod",
    download_kind: "video",
    start,
    end,
    fragments: [],
    split: false,
    split_interval_minutes: null,
    quality: quality !== "best" ? quality : null,
    quality_has_audio: selectedQualityMeta?.has_audio ?? null,
    quality_has_video: selectedQualityMeta?.has_video ?? null,
    quality_height: selectedQualityMeta?.height ?? null,
    unmute_video: false,
    proxy: { enabled: runtime.useProxy, url: runtime.proxyUrl || settings.proxy.url },
    chat_overlay: { ...settings.chatOverlay, enabled: false },
    performance: settings.performance ?? defaultPerformanceSettings,
    blur_zones: blurZones,
    binaries_dir: settings.binariesDir,
    meta: resolved
      ? {
          title: resolved.title,
          uploader: resolved.uploader,
          platform: resolved.platform,
          thumbnail: resolved.thumbnail,
          duration: resolved.duration,
        }
      : {
          platform: activeSource === "m3u8" ? "hls" : activeSource,
        },
  });

  return (
    <div className={`${fetchrThemeClassName} ${styles.backdrop}`} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="add-task-title">
        <header className={styles.header}>
          <div>
            <h2 className={styles.title} id="add-task-title">
              Добавить задачу
            </h2>
            <div className={styles.subtitle}>Добавьте источник, проверьте preview и отметьте нужный диапазон скачивания.</div>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Закрыть" onClick={onClose}>
            <RedesignIcon name="close" className="size-[16px]" />
          </button>
        </header>

        <SourceTabs
          activeSource={activeSource}
          onSourceChange={(nextSource) => {
            setSource(nextSource);
            setResolved(null);
            setQuality("best");
            setError(null);
            clearPreview();
          }}
        />

        <main className={styles.content}>
          <AddTaskForm
            sourceUrl={sourceUrl}
            fileName={fileName}
            quality={quality}
            downloadFolder={downloadFolder}
            start={start}
            end={end}
            ranges={ranges}
            downloadChatEnabled={downloadChatEnabled}
            sponsorBlurEnabled={sponsorBlurEnabled}
            additionalOpen={additionalOpen}
            analyzing={analyzing}
            error={error}
            resolved={resolved}
            previewUrl={previewUrl}
            previewEmbedUrl={previewEmbedUrl}
            previewLoading={previewLoading}
            previewError={previewError}
            presetName={activePreset?.name ?? "Fast Save"}
            sourceLabel={sourceLabel}
            qualityOptions={qualityOptions}
            m3u8VideoOnly={m3u8VideoOnly}
            chatPresets={chatPresets.map((preset) => ({ id: preset.id, name: preset.name }))}
            activeChatPresetId={activeChatPreset?.id ?? ""}
            sponsorBlurPresets={sponsorPresets.map((preset) => ({ id: preset.id, name: preset.name }))}
            activeSponsorPresetId={activeSponsorPreset?.id ?? ""}
            onSourceUrlChange={(value) => {
              setSourceUrlForActive(value);
              setResolved(null);
              setError(null);
              clearPreview();
            }}
            onFileNameChange={setFileName}
            onQualityChange={setQuality}
            onDownloadFolderChange={setDownloadFolder}
            onChooseFolder={() => void chooseFolder((directory) => {
              setDownloadFolder(directory);
              settings.setDirectory(directory);
            })}
            onPasteSource={() => void pasteSource(setSourceUrlForActive)}
            onAnalyze={() => void analyze()}
            onDownloadChatChange={setDownloadChatEnabled}
            onChatPresetChange={setActiveChatPreset}
            onSponsorBlurChange={setSponsorBlurEnabled}
            onSponsorPresetChange={setActiveSponsorPreset}
            onConfigureBlur={onConfigureBlur ?? (() => undefined)}
            onStartChange={setStart}
            onEndChange={setEnd}
            onAddRange={() => {
              setRanges((items) => [...items, { id: crypto.randomUUID(), start, end }]);
              setStart("");
              setEnd("");
            }}
            onUpdateRange={(id, patch) =>
              setRanges((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
            }
            onRemoveRange={(id) => setRanges((items) => items.filter((item) => item.id !== id))}
          />
        </main>

        <footer className={styles.footer}>
          <button className={styles.extraButton} type="button" onClick={() => setAdditionalOpen((value) => !value)}>
            Дополнительные настройки {additionalOpen ? "⌃" : "⌄"}
          </button>
          <div className={styles.footerActions}>
            <button className={styles.button} type="button" onClick={onClose}>
              Отмена
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void submit()}
              disabled={!sourceUrl.trim() || !downloadFolder.trim() || submitting}
            >
              <RedesignIcon name={submitting ? "loading" : "add"} className="size-[15px]" />
              Добавить в очередь
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  function resetAfterSubmit() {
    resetDraft();
  }

  function resetDraft() {
    setSource("twitch");
    setSourceUrls(createEmptySourceUrls());
    setFileName("");
    setQuality(runtime.quality || "best");
    setDownloadFolder(runtime.directory || settings.directory);
    setStart("");
    setEnd("");
    setRanges([]);
    setDownloadChatEnabled(Boolean(runtime.downloadChat));
    setSponsorBlurEnabled(Boolean(runtime.blurSponsors));
    setAdditionalOpen(false);
    setResolved(null);
    setError(null);
    clearPreview();
  }

  function setSourceUrlForActive(value: string) {
    setSourceUrls((items) => ({ ...items, [activeSource]: value }));
  }

  function clearPreview() {
    stopPreviewSession(previewSource);
    setPreviewUrl(null);
    setPreviewEmbedUrl(null);
    setPreviewSource(null);
    setPreviewLoading(false);
    setPreviewError(null);
  }

  async function loadPreview(result: ResolvedStream) {
    clearPreview();
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      if (result.platform === "youtube") {
        const embed = youtubeEmbedUrl(sourceUrl.trim());
        if (embed) {
          setPreviewEmbedUrl(embed);
          return;
        }
      }
      const preview = await ipc.startStreamPreview(
        sourceUrl.trim(),
        { enabled: runtime.useProxy, url: runtime.proxyUrl || settings.proxy.url },
        settings.binariesDir,
        quality !== "best" ? quality : null,
      );
      setPreviewSource(preview);
      setPreviewUrl(preview.url);
    } catch (reason) {
      setPreviewError(String(reason));
    } finally {
      setPreviewLoading(false);
    }
  }
}

function stopPreviewSession(previewSource: PreviewSource | null) {
  if (previewSource?.id) {
    void ipc.stopStreamPreview(previewSource.id).catch(() => undefined);
  }
}

function youtubeEmbedUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? parsed.pathname.slice(1).split("/")[0]
        : parsed.searchParams.get("v") ??
          parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    const id = input.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{6,})/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
}

async function chooseFolder(onSelected: (value: string) => void) {
  const directory = await ipc.chooseDirectory();
  if (directory) onSelected(directory);
}

async function pasteSource(setSourceUrl: (value: string) => void) {
  try {
    const text = await navigator.clipboard.readText();
    setSourceUrl(text);
  } catch {
    // Clipboard access is optional in WebView contexts.
  }
}

function normalizeSource(platform: string): AddTaskSource {
  if (platform === "youtube") return "youtube";
  if (platform === "kick") return "kick";
  if (platform === "hls") return "m3u8";
  if (platform === "rtmp") return "rtmp";
  return "twitch";
}

function getSourceLabel(source: AddTaskSource): string {
  switch (source) {
    case "youtube":
      return "YouTube";
    case "kick":
      return "Kick";
    case "m3u8":
      return "HLS / m3u8";
    case "rtmp":
      return "RTMP";
    case "twitch":
      return "Twitch";
  }
}

function twitchVodChatSourceUrl(input: string): string | null {
  const trimmed = input.trim();
  return /(?:^https?:\/\/)?(?:www\.)?twitch\.tv\/(?:videos|video|v)\/\d+/i.test(trimmed) ? trimmed : null;
}

function createEmptySourceUrls(): Record<AddTaskSource, string> {
  return {
    twitch: "",
    youtube: "",
    kick: "",
    m3u8: "",
    rtmp: "",
  };
}
