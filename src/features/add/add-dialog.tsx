import { useEffect, useRef, useState, type ElementType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ClipboardPaste,
  Loader2,
  Clock,
  Crosshair,
  RefreshCw,
  Copy,
  Trash2,
  ListPlus,
  Scissors,
  Eye,
  Radio,
  MessageSquareText,
  Info,
  ScanSearch,
  Youtube,
  Gamepad2,
  FileCode2,
  RadioTower,
  Link2,
  FileText,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { HlsPlayer, type HlsPlayerHandle } from "@/components/hls-player";
import { PresetInlineAction } from "@/components/preset-inline-action";
import { isFetchrRedesignEnabled } from "@/config/featureFlags";

import { useUI } from "@/stores/ui";
import { defaultPerformanceSettings, useSettings } from "@/stores/settings";
import {
  defaultPresetRuntimeSettings,
  type PresetFeatureId,
  usePresets,
} from "@/stores/presets";
import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import { detectPlatform, platformLabel } from "@/lib/url";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddTaskModal } from "@/ui/redesign/add-task";
import type {
  ChatOverlaySettings,
  DownloadKind,
  JobSpec,
  PerformanceSettings,
  PreviewSource,
  Quality,
  ResolvedStream,
} from "@/types/job";

interface FragmentDraft {
  id: string;
  start: string;
  end: string;
}

type SourceTabId = "twitch" | "youtube" | "kick" | "m3u8" | "rtmp";

const sourceTabs: Array<{
  id: SourceTabId;
  label: string;
  icon: ElementType;
  hint: string;
}> = [
  { id: "twitch", label: "twitch.tv", icon: Gamepad2, hint: "https://twitch.tv/channel" },
  { id: "youtube", label: "youtube.com", icon: Youtube, hint: "https://youtube.com/watch?v=..." },
  { id: "kick", label: "kick.com", icon: RadioTower, hint: "https://kick.com/channel" },
  { id: "m3u8", label: "m3u8", icon: FileCode2, hint: "https://.../index.m3u8" },
  { id: "rtmp", label: "rtmp", icon: RadioTower, hint: "rtmp://server/app/key" },
];

function toHms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatQualityLabel(q: Quality, noAudioLabel: string): string {
  const parts: string[] = [q.label.replace(/\s+/g, " ").trim()];

  if (q.ext) {
    parts.push(q.ext);
  }
  if (!q.has_video && q.abr) {
    parts.push(`${Math.round(q.abr)}k`);
  }
  if (q.has_video && q.has_audio === false) {
    parts.push(noAudioLabel);
  }

  return parts.join(" · ");
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

function isKickVodUrl(input: string): boolean {
  const lowered = input.toLowerCase();
  return lowered.includes("kick.com") && (lowered.includes("/videos/") || lowered.includes("/video/"));
}

function parseHms(value: string): number | null {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  const [hours, minutes, seconds] = parts;
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function normalizeHms(value: string): string | null {
  const parts = value.split(":").map((part) => Number(part));
  if (parseHms(value) === null) {
    return null;
  }
  return `${String(parts[0]).padStart(2, "0")}:${String(parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}`;
}

function parseTimecodeList(text: string): {
  clips: Array<{ start: string; end: string }>;
  errors: string[];
} {
  const clips: Array<{ start: string; end: string }> = [];
  const errors: string[] = [];
  const separator = String.raw`(?:-|–|—|→|\s+to\s+)`;
  const linePattern = new RegExp(
    String.raw`^\s*(\d{1,3}:\d{2}:\d{2})\s*${separator}\s*(\d{1,3}:\d{2}:\d{2})\s*$`,
    "i",
  );

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    const match = line.match(linePattern);
    if (!match) {
      errors.push(`line ${index + 1}`);
      return;
    }
    const start = normalizeHms(match[1]);
    const end = normalizeHms(match[2]);
    const startSeconds = start ? parseHms(start) : null;
    const endSeconds = end ? parseHms(end) : null;
    if (!start || !end || startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
      errors.push(`line ${index + 1}`);
      return;
    }
    clips.push({ start, end });
  });

  return { clips, errors };
}

export function AddDialog() {
  if (isFetchrRedesignEnabled()) return <RedesignAddDialog />;
  return <LegacyAddDialog />;
}

function RedesignAddDialog() {
  const open = useUI((state) => state.addDialogOpen);
  const close = useUI((state) => state.closeAddDialog);
  const navigate = useNavigate();

  return (
    <AddTaskModal
      open={open}
      onClose={close}
      onConfigureBlur={() => {
        close();
        void navigate({ to: "/sponsor-blur" });
      }}
    />
  );
}

function LegacyAddDialog() {
  const { t } = useTranslation();
  const open = useUI((s) => s.addDialogOpen);
  const close = useUI((s) => s.closeAddDialog);
  const settings = useSettings();
  const presets = usePresets((s) => s.presets);
  const activePresetId = usePresets((s) => s.activePresetId);
  const updatePresetRuntime = usePresets((s) => s.updatePresetRuntime);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const presetRuntime = {
    ...defaultPresetRuntimeSettings,
    ...activePreset?.runtime,
  };
  const presetHas = (featureId: PresetFeatureId) =>
    Boolean(activePreset?.features.includes(featureId));
  const canPreview = presetHas("preview");
  const canQuality = presetHas("quality");
  const canClips = presetHas("clips");
  const canSplit = presetHas("split");
  const canChat = presetHas("chat");
  const canSponsorBlur = presetHas("sponsorBlur");
  const canProxy = presetHas("proxy");
  const canPerformance = presetHas("performance");
  const layoutFor = (featureId: PresetFeatureId) => activePreset?.layout?.[featureId];
  const panelCompact = (featureId: PresetFeatureId) => Boolean(layoutFor(featureId)?.compact);

  const [url, setUrl] = useState("");
  const [sourceTab, setSourceTab] = useState<SourceTabId>("twitch");
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fragments, setFragments] = useState<FragmentDraft[]>([]);
  const [bulkTimecodes, setBulkTimecodes] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [split, setSplit] = useState(false);
  const [splitMinutes, setSplitMinutes] = useState(1);
  const [downloadKind, setDownloadKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<string>("best");
  const [downloadChat, setDownloadChat] = useState(false);
  const [blurSponsors, setBlurSponsors] = useState(false);
  const [unmuteVideo, setUnmuteVideo] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:2080");

  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState<ResolvedStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewEmbedUrl, setPreviewEmbedUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const playerRef = useRef<HlsPlayerHandle | null>(null);
  const previewSessionRef = useRef<string | null>(null);

  const urlRef = useRef<HTMLInputElement | null>(null);

  const stopPreviewSession = () => {
    const id = previewSessionRef.current;
    previewSessionRef.current = null;
    if (id) {
      void ipc.stopStreamPreview(id).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!open) return;
    stopPreviewSession();
    setError(null);
    setResolved(null);
    setPreviewUrl(null);
    setPreviewEmbedUrl(null);
    setPreviewSource(null);
    setPreviewError(null);
    setDownloadKind(canQuality ? presetRuntime.downloadKind : "video");
    setQuality(canQuality ? presetRuntime.quality : "best");
    setDownloadChat(canChat ? presetRuntime.downloadChat : false);
    setBlurSponsors(canSponsorBlur ? presetRuntime.blurSponsors : false);
    setUnmuteVideo(canQuality ? presetRuntime.unmuteVideo : false);
    setFragments([]);
    setBulkTimecodes("");
    setBulkError(null);
    setSplit(canSplit ? presetRuntime.split : false);
    setSplitMinutes(presetRuntime.splitMinutes);
    setDirectory(presetRuntime.directory ?? settings.directory);
    setUseProxy(canProxy ? presetRuntime.useProxy : false);
    setProxyUrl(presetRuntime.proxyUrl || settings.proxy.url);
    setTimeout(() => urlRef.current?.focus(), 50);
  }, [activePresetId, open]);

  useEffect(() => {
    if (!open) {
      stopPreviewSession();
    }
    return () => stopPreviewSession();
  }, [open]);

  useEffect(() => {
    if (!open || !activePreset) return;
    updatePresetRuntime(activePreset.id, {
      directory: directory.trim() ? directory : null,
      downloadKind,
      quality,
      isLive,
      split,
      splitMinutes,
      downloadChat,
      blurSponsors,
      unmuteVideo,
      useProxy,
      proxyUrl,
    });
  }, [
    activePreset?.id,
    blurSponsors,
    directory,
    downloadChat,
    downloadKind,
    isLive,
    open,
    proxyUrl,
    quality,
    split,
    splitMinutes,
    unmuteVideo,
    updatePresetRuntime,
    useProxy,
  ]);

  const platform = detectPlatform(url);
  const activeSourceTab = sourceTabs.some((tab) => tab.id === platform)
    ? (platform as SourceTabId)
    : sourceTab;
  const activeSourceHint =
    sourceTabs.find((tab) => tab.id === activeSourceTab)?.hint ?? t("add.url_placeholder");
  const bestAudioLabel = t("add.quality_best_audio", { defaultValue: "Лучшее аудио" });
  const noAudioLabel = t("add.no_audio", { defaultValue: "без звука" });
  const downloadTypeLabel = t("add.download_type", { defaultValue: "Тип загрузки" });
  const downloadTypeVideoLabel = t("add.download_type_video", { defaultValue: "Видео" });
  const downloadTypeAudioLabel = t("add.download_type_audio", { defaultValue: "Только аудио" });
  const resolvedPlatform = resolved?.platform ?? platform;
  const showYoutubeOptions = canQuality && resolvedPlatform === "youtube";
  const showUnmuteVideo =
    canQuality && resolvedPlatform === "twitch" && !isLive && downloadKind === "video";
  const showKickVodChatWarning =
    canChat && downloadChat && downloadKind === "video" && resolvedPlatform === "kick" && isKickVodUrl(url);
  const showKickLiveChatHint =
    canChat && downloadChat && downloadKind === "video" && resolvedPlatform === "kick" && isLive && !isKickVodUrl(url);
  const forceVodMode = resolvedPlatform === "kick" && isKickVodUrl(url);
  const visibleQualities = canQuality
    ? (resolved?.qualities ?? []).filter((q) =>
        downloadKind === "audio" ? !q.has_video && q.has_audio : q.has_video,
      )
    : [];
  const selectedQualityMeta =
    !canQuality || quality === "best"
      ? null
      : resolved?.qualities.find((q) => q.id === quality) ?? null;
  const qualityGroups = [
    ["recommended", t("add.quality_group_recommended", { defaultValue: "Recommended" })],
    ["combined", t("add.quality_group_combined", { defaultValue: "Video + audio" })],
    ["video", t("add.quality_group_video", { defaultValue: "Video + best audio" })],
    ["audio", t("add.quality_group_audio", { defaultValue: "Audio only" })],
    ["other", t("add.quality_group_other", { defaultValue: "Other" })],
  ] as const;
  const groupedQualities = qualityGroups
    .map(([group, label]) => ({
      group,
      label,
      items: visibleQualities.filter((q) => (q.group ?? "other") === group),
    }))
    .filter((group) => group.items.length > 0);
  const bestAudioQuality = (resolved?.qualities ?? [])
    .filter((q) => q.has_audio)
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];
  const audioInfo = resolved
    ? {
        hasAudio: Boolean(bestAudioQuality),
        qualityLabel: bestAudioQuality?.abr
          ? `${Math.round(bestAudioQuality.abr)} kbps`
          : bestAudioQuality?.ext ?? null,
      }
    : null;

  useEffect(() => {
    if ((!canQuality || !showYoutubeOptions) && downloadKind !== "video") {
      setDownloadKind("video");
    }
  }, [canQuality, downloadKind, showYoutubeOptions]);

  useEffect(() => {
    if (!quality || quality === "best") return;
    if (!visibleQualities.some((q) => q.id === quality)) {
      setQuality("best");
    }
  }, [quality, visibleQualities]);

  useEffect(() => {
    if ((!canSplit || downloadKind === "audio") && split) {
      setSplit(false);
    }
  }, [canSplit, downloadKind, split]);

  useEffect(() => {
    if (!canChat && downloadChat) setDownloadChat(false);
    if (!canSponsorBlur && blurSponsors) setBlurSponsors(false);
    if (!canProxy && useProxy) setUseProxy(false);
  }, [blurSponsors, canChat, canProxy, canSponsorBlur, downloadChat, useProxy]);

  useEffect(() => {
    if (!showUnmuteVideo && unmuteVideo) {
      setUnmuteVideo(false);
    }
  }, [showUnmuteVideo, unmuteVideo]);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      /* noop */
    }
  };

  const resolve = async () => {
    if (!url.trim()) return;
    setResolving(true);
    setError(null);
    stopPreviewSession();
    setPreviewUrl(null);
    setPreviewEmbedUrl(null);
    setPreviewSource(null);
    setPreviewError(null);
    try {
      const r = await ipc.resolveStream(
        url,
        { enabled: canProxy && useProxy, url: proxyUrl },
        settings.binariesDir,
      );
      setResolved(r);
      if (!name && r.title) {
        setName(r.title.slice(0, 80));
      }
      setIsLive(r.is_live);
      if (canPreview) void loadPreview(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setResolving(false);
    }
  };

  const loadPreview = async (r: ResolvedStream | null) => {
    if (!canPreview) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewEmbedUrl(null);
    setPreviewSource(null);
    stopPreviewSession();
    try {
      const platformForPreview = r?.platform ?? detectPlatform(url);
      if (platformForPreview === "youtube") {
        const embed = youtubeEmbedUrl(url);
        if (embed) {
          setPreviewUrl(null);
          setPreviewEmbedUrl(embed);
          return;
        }
      }
      const preview = await ipc.startStreamPreview(
        url,
        { enabled: canProxy && useProxy, url: proxyUrl },
        settings.binariesDir,
        canQuality && quality !== "best" ? quality : null,
      );
      previewSessionRef.current = preview.id;
      setPreviewSource(preview);
      setPreviewUrl(preview.url);
    } catch (e) {
      setPreviewError(String(e));
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const retryPreview = () => {
    void loadPreview(resolved);
  };

  const copyPreviewUrl = async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
    } catch {
      /* noop */
    }
  };

  const submit = async () => {
    if (!url.trim() || !name.trim() || !directory.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const effectiveDownloadKind = canQuality ? downloadKind : "video";
      const shouldDownloadChat = canChat && downloadChat && effectiveDownloadKind === "video";
      const activeBlurZones =
        canSponsorBlur && blurSponsors && effectiveDownloadKind === "video"
          ? settings.blurZones.filter((zone) => zone.enabled)
          : [];
      const cleanFragments = canClips
        ? fragments
            .map((fragment) => ({
              start: fragment.start.trim(),
              end: fragment.end.trim(),
            }))
            .filter((fragment) => fragment.start && fragment.end)
        : [];
      const buildSpec = (
        overrides: Pick<
          JobSpec,
          "name" | "start" | "end" | "fragments" | "split" | "split_interval_minutes"
        >,
      ): JobSpec => ({
        url: url.trim(),
        chat_source_url: twitchVodChatSourceUrl(url),
        name: overrides.name,
        directory: directory.trim(),
        job_kind: "video",
        mode: isLive && !forceVodMode ? "live" : "vod",
        download_kind: effectiveDownloadKind,
        start: canClips ? overrides.start : null,
        end: canClips ? overrides.end : null,
        fragments: canClips ? overrides.fragments : [],
        split: canSplit ? overrides.split : false,
        split_interval_minutes: canSplit ? overrides.split_interval_minutes : null,
        quality: canQuality && quality !== "best" ? quality : null,
        quality_has_audio: selectedQualityMeta?.has_audio ?? null,
        quality_has_video: selectedQualityMeta?.has_video ?? null,
        quality_height: selectedQualityMeta?.height ?? null,
        unmute_video: showUnmuteVideo ? unmuteVideo : false,
        proxy: { enabled: canProxy && useProxy, url: proxyUrl },
        chat_overlay: { ...settings.chatOverlay, enabled: shouldDownloadChat },
        performance: canPerformance ? settings.performance : defaultPerformanceSettings,
        blur_zones: activeBlurZones,
        binaries_dir: settings.binariesDir,
        meta: resolved
          ? {
              title: resolved.title,
              uploader: resolved.uploader,
              platform: resolved.platform,
              thumbnail: resolved.thumbnail,
              duration: resolved.duration,
            }
          : { platform },
      });
      if (cleanFragments.length > 0) {
        for (const [index, fragment] of cleanFragments.entries()) {
          await StreamDownloader.enqueueWithChat(
            buildSpec({
              name: `${name.trim()}_clip${String(index + 1).padStart(2, "0")}`,
              start: fragment.start,
              end: fragment.end,
              fragments: [],
              split,
              split_interval_minutes: split ? splitMinutes : null,
            }),
            settings.chatOverlay,
            shouldDownloadChat,
          );
        }
      } else {
        await StreamDownloader.enqueueWithChat(
          buildSpec({
            name: name.trim(),
            start: start || null,
            end: end || null,
            fragments: [],
            split,
            split_interval_minutes: split ? splitMinutes : null,
          }),
          settings.chatOverlay,
          shouldDownloadChat,
        );
      }
      close();
      setUrl("");
      setName("");
      setStart("");
      setEnd("");
      setFragments([]);
      setBulkTimecodes("");
      setBulkError(null);
    } catch (err) {
      setError(`Не удалось добавить задание в очередь: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const chooseDir = async () => {
    const d = await ipc.chooseDirectory();
    if (d) setDirectory(d);
  };

  const setStartFromPlayer = () => {
    const s = playerRef.current?.getCurrentTime() ?? 0;
    setStart(toHms(s));
  };
  const setEndFromPlayer = () => {
    const s = playerRef.current?.getCurrentTime() ?? 0;
    setEnd(toHms(s));
  };
  const addFragment = () => {
    setFragments((items) => [
      ...items,
      { id: crypto.randomUUID(), start, end },
    ]);
    setStart("");
    setEnd("");
  };
  const addBulkFragments = () => {
    const { clips, errors } = parseTimecodeList(bulkTimecodes);
    if (clips.length === 0) {
      setBulkError(
        t("add.bulk_no_clips", {
          defaultValue: "No valid intervals found.",
        }),
      );
      return;
    }
    setFragments((items) => [
      ...items,
      ...clips.map((clip) => ({
        id: crypto.randomUUID(),
        start: clip.start,
        end: clip.end,
      })),
    ]);
    setBulkTimecodes("");
    setBulkError(
      errors.length > 0
        ? t("add.bulk_some_invalid", {
            count: errors.length,
            defaultValue: "{{count}} line(s) skipped.",
          })
        : null,
    );
  };
  const updateFragment = (
    id: string,
    field: "start" | "end",
    value: string,
  ) => {
    setFragments((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };
  const removeFragment = (id: string) => {
    setFragments((items) => items.filter((item) => item.id !== id));
  };

  return (
    <TooltipProvider delayDuration={180}>
    <Dialog open={open} onOpenChange={(v) => (v ? null : close())}>
      <DialogContent className="w-[min(1120px,calc(100vw-32px))] max-w-none overflow-hidden border-[#31415A]/80 bg-[#111926]/95 shadow-[0_30px_90px_rgba(0,0,0,0.48),0_0_0_1px_rgba(133,183,235,0.08)] backdrop-blur-xl">
        <DialogHeader className="premium-stagger premium-stagger-1 border-b border-[#2A3850] bg-[linear-gradient(180deg,rgba(20,31,47,0.98),rgba(17,25,38,0.92))] px-5 pb-4 pt-5">
          <DialogTitle className="text-[18px] font-semibold text-white">{t("add.title")}</DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] text-[#9DB0CA]">
            Добавьте источник и настройте загрузку в одном рабочем пространстве.
          </DialogDescription>
          <div className="mt-4 grid grid-cols-5 gap-1 rounded-lg border border-[#2A3850] bg-[#0B1220]/70 p-1" role="tablist" aria-label="Источник стрима">
            {sourceTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeSourceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "group flex h-9 items-center justify-center gap-2 rounded-md border text-[12px] font-semibold transition-all focus-visible:outline-none focus-visible:shadow-focus-ring",
                    active
                      ? "border-[#6D78FF]/55 bg-[linear-gradient(135deg,rgba(55,138,221,0.34),rgba(109,82,255,0.34))] text-white shadow-[0_0_24px_rgba(55,138,221,0.18)]"
                      : "border-transparent bg-transparent text-[#9DB0CA] hover:bg-white/[0.04] hover:text-white",
                  )}
                  onClick={() => setSourceTab(tab.id)}
                >
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-[#A7C8FF]" : "text-[#71829D] group-hover:text-[#9DB0CA]")} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="max-h-[72vh] overflow-auto bg-[radial-gradient(circle_at_20%_0%,rgba(55,138,221,0.08),transparent_32%),#0E1623] p-5">
          <section className="premium-stagger premium-stagger-2 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
            <div className="premium-card rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#EAF2FF]">
                  <Link2 className="h-4 w-4 text-[#85B7EB]" />
                  1. {t("add.url")}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] uppercase text-[#71829D]">{activeSourceTab}</span>
                  <PresetInlineAction featureId="resolve" />
                </div>
              </div>
              <div className="flex gap-2">
              <Input
                ref={urlRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={activeSourceHint}
                className="h-9 border-[#2A3850] bg-[#08111D] font-mono text-[12px] shadow-inner placeholder:text-[#56657C]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    void submit();
                  }
                }}
              />
              <Button size="md" variant="secondary" onClick={paste} className="h-9 border-[#34455F] bg-[#172234] hover:bg-[#1C2A40]">
                <ClipboardPaste className="h-3.5 w-3.5" />
                {t("add.paste")}
              </Button>
              <Button size="md" variant="primary" onClick={resolve} disabled={!url || resolving} className="h-9 bg-[linear-gradient(135deg,#378ADD,#5E5CE6)] shadow-[0_8px_22px_rgba(55,138,221,0.22)] hover:brightness-110">
                {resolving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {resolving ? t("add.resolving") : t("add.resolve")}
              </Button>
              {canPreview && (
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => void loadPreview(resolved)}
                  disabled={!url || previewLoading}
                  title="Preview stream"
                  className="h-9 border-[#34455F] bg-[#172234] hover:bg-[#1C2A40]"
                >
                  {previewLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {t("add.preview")}
                </Button>
              )}
              </div>
            {url && (
              <div className="flex items-center gap-2 pt-0.5 text-[11px] text-fg-tertiary">
                <span className="font-mono">{platformLabel(platform as never)}</span>
                {resolved && (
                  <>
                    <span>·</span>
                    <span className="truncate">{resolved.title ?? "—"}</span>
                    {resolved.uploader && (
                      <>
                        <span>·</span>
                        <span>{resolved.uploader}</span>
                      </>
                    )}
                    {resolved.duration && (
                      <>
                        <span>·</span>
                        <span className="font-mono tabular">{formatDuration(resolved.duration)}</span>
                      </>
                    )}
                    {resolved.is_live && <StatusBadge status="running" live />}
                  </>
                )}
              </div>
            )}
            {error && <span className="text-[11px] text-danger">{error}</span>}
            </div>

            <div className="premium-card rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
            <Label className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[#EAF2FF]">
              <FileText className="h-4 w-4 text-[#85B7EB]" />
              2. {t("add.name")}
              <InfoTip text="Имя будущего файла. Поле вынесено наверх, чтобы правая колонка не ломалась на длинных названиях." />
              <PresetInlineAction featureId="logs" className="ml-auto" />
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={resolved?.title ?? "Stream_cut"}
              className="h-9 min-w-0 border-[#2A3850] bg-[#0B1422]"
            />
            </div>

          {/* Preview pane */}
          {canPreview && (previewEmbedUrl || previewUrl || previewLoading || previewError || resolved?.thumbnail) && (
            <div
              className="premium-card flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-[#2A3850] p-4 lg:col-start-2 lg:row-span-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label>{t("add.preview")}</Label>
                  {previewSource && (
                    <div className="flex items-center gap-1.5 text-[10.5px] text-fg-tertiary">
                      <span className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono uppercase">
                        <Radio className="h-3 w-3 text-accent" />
                        {previewSource.platform}
                      </span>
                      <span className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono uppercase">
                        {previewSource.mode}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {previewUrl && (
                    <>
                      <Button size="md" variant="secondary" onClick={setStartFromPlayer}>
                        <Crosshair className="h-3.5 w-3.5" />
                        {t("add.set_start")}
                      </Button>
                      <Button size="md" variant="secondary" onClick={setEndFromPlayer}>
                        <Crosshair className="h-3.5 w-3.5" />
                        {t("add.set_end")}
                      </Button>
                      <Button size="md" variant="ghost" onClick={copyPreviewUrl} title="Copy preview URL">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={retryPreview}
                    disabled={previewLoading}
                    title="Retry preview"
                  >
                    <RefreshCw className={previewLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  </Button>
                </div>
              </div>
              {previewEmbedUrl ? (
                <>
                  <div className="overflow-hidden rounded border border-border-default bg-black">
                    <iframe
                      src={previewEmbedUrl}
                      className="aspect-video w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  <span className="truncate font-mono text-[10.5px] text-fg-tertiary" title={previewEmbedUrl}>
                    {previewEmbedUrl}
                  </span>
                </>
              ) : previewUrl ? (
                <>
                  <HlsPlayer
                    ref={playerRef}
                    src={previewUrl}
                    className="w-full"
                    audioInfo={audioInfo}
                  />
                  <span className="truncate font-mono text-[10.5px] text-fg-tertiary" title={previewUrl}>
                    {previewUrl}
                  </span>
                </>
              ) : previewLoading ? (
                <div className="flex h-40 items-center justify-center rounded border border-border-default bg-elevated text-[12px] text-fg-tertiary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("add.preview_loading")}
                </div>
              ) : previewError ? (
                <div className="flex flex-col gap-1 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
                  <span>Не удалось получить HLS: {previewError}</span>
                  {resolved?.thumbnail && (
                    <img
                      src={resolved.thumbnail}
                      alt=""
                      className="mt-1 w-full max-h-60 rounded border border-border-default object-contain bg-black"
                    />
                  )}
                </div>
              ) : resolved?.thumbnail ? (
                <img
                  src={resolved.thumbnail}
                  alt=""
                  className="w-full max-h-60 rounded border border-border-default object-contain bg-black"
                />
              ) : null}
            </div>
          )}

          {canQuality && (
          <div className="premium-card grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label className="flex items-center gap-1.5">
                {t("add.quality")}
                <InfoTip text="Качество исходного видео. Чем выше качество и FPS, тем дольше скачивание и финальная сборка." />
                <PresetInlineAction featureId="quality" className="ml-auto" />
              </Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      downloadKind === "audio" ? bestAudioLabel : t("add.quality_best")
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-w-[min(560px,calc(100vw-48px))]">
                  <SelectItem value="best">
                    {downloadKind === "audio" ? bestAudioLabel : t("add.quality_best")}
                  </SelectItem>
                  {groupedQualities.map((group) => (
                    <SelectGroup key={group.group}>
                      <SelectLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
                        {group.label}
                      </SelectLabel>
                      {group.items.map((q) => (
                        <SelectItem key={q.id} value={q.id} title={q.id}>
                          {formatQualityLabel(q, noAudioLabel)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          )}

          {showUnmuteVideo && (
            <div className="premium-card flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#2A3850] px-4 py-3 lg:col-start-1">
              <label className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-fg-secondary">
                <Switch checked={unmuteVideo} onCheckedChange={setUnmuteVideo} />
                <span className="truncate">Восстановить звук VOD</span>
                <InfoTip text="Для Twitch VOD с замученными по АП участками пробует скачать -unmuted сегменты вместо -muted. Если Twitch уже удалил unmuted-сегменты, этот участок останется muted, а скачка откатится к обычному режиму при сбое." />
              </label>
              <span className="shrink-0 text-[11px] text-fg-tertiary">
                {unmuteVideo ? "on" : "off"}
              </span>
            </div>
          )}

          {showYoutubeOptions && (
            <div className="premium-card flex flex-col gap-2 rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
              <Label className="flex items-center gap-1.5">
                {downloadTypeLabel}
                <InfoTip text="Видео — скачивает ролик. Только аудио — чат и видео-оверлей не применяются." />
              </Label>
              <Select
                value={downloadKind}
                onValueChange={(value: "video" | "audio") => setDownloadKind(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">{downloadTypeVideoLabel}</SelectItem>
                  <SelectItem value="audio">{downloadTypeAudioLabel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="premium-card flex flex-col gap-2 rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
            <Label className="flex items-center gap-1.5">
              {t("add.directory")}
              <InfoTip text="Папка для всех результатов: чистого видео, alpha-чата и итогового видео с чатом." />
            </Label>
            <div className="flex gap-1.5">
              <Input value={directory} onChange={(e) => setDirectory(e.target.value)} className="font-mono text-[12px]" />
              <Button size="md" variant="secondary" onClick={chooseDir}>…</Button>
            </div>
          </div>

          {canSponsorBlur && (
          <div className="premium-card flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-[#2A3850] p-4 lg:col-start-2">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[12px] font-medium text-fg-secondary">
                <Switch
                  checked={blurSponsors}
                  onCheckedChange={(enabled) => {
                    setBlurSponsors(enabled);
                    settings.setSponsorBlurEnabled(enabled);
                  }}
                  disabled={downloadKind === "audio"}
                />
                <ScanSearch className="h-3.5 w-3.5 text-accent" />
                Блюр спонсоров
                <InfoTip text="При включении применяются зоны со страницы “Блюр спонсоров”. Если выключено, видео скачивается без blur/image-overlay зон." />
                <PresetInlineAction featureId="sponsorBlur" />
              </label>
              <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                {settings.blurZones.filter((zone) => zone.enabled).length} zones
              </span>
            </div>
            {blurSponsors && (
              <div className="rounded border border-border-subtle bg-surface px-2 py-1.5 text-[11.5px] text-fg-secondary">
                Reference:{" "}
                <span className="font-mono text-fg-tertiary">
                  {settings.sponsorBlurReferencePath ?? "не выбрано"}
                </span>
              </div>
            )}
          </div>
          )}

          {canChat && (
          <div className="premium-card flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-[#2A3850] p-4 lg:col-start-2">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[12px] font-medium text-fg-secondary">
                <Switch
                  checked={downloadChat}
                  onCheckedChange={setDownloadChat}
                  disabled={downloadKind === "audio"}
                />
                <MessageSquareText className="h-3.5 w-3.5 text-accent" />
                {t("add.download_chat")}
                <InfoTip text="Если включено, после видео программа скачает чат, отрендерит прозрачный слой и соберёт итоговое видео с чатом." />
                <PresetInlineAction featureId="chat" />
              </label>
              <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                {settings.chatOverlay.chat_x ?? 80}:{settings.chatOverlay.chat_y ?? 760} /{" "}
                {settings.chatOverlay.chat_width ?? 1760}x{settings.chatOverlay.chat_height ?? 260}
              </span>
            </div>
            {downloadChat && (
              <div className="rounded border border-border-subtle bg-surface px-2 py-1.5 text-[11.5px] text-fg-secondary">
                Рендер применит сохранённые настройки со страницы “Рендер чата”. Отдельный рендер только чата теперь находится там же.
              </div>
            )}
            {showKickVodChatWarning && (
              <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11.5px] text-warning">
                Kick VOD chat is best-effort: it works only when Kick or KickVOD exposes an archived chat replay. If no replay exists, the job will fail clearly instead of rendering an empty chat.
              </div>
            )}
            {showKickLiveChatHint && (
              <div className="rounded border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11.5px] text-accent">
                Kick live chat will be recorded only from the moment this job starts. Use the live channel URL, not a /videos/ link.
              </div>
            )}
          </div>
          )}

          {(canClips || canSplit) && (
          <div className="premium-card flex min-w-0 flex-col gap-3 overflow-auto rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Scissors className="h-3.5 w-3.5 text-accent" />
                {t("add.clips_panel", { defaultValue: "Clips" })}
                <InfoTip text="Можно скачать один диапазон или список фрагментов. Чат будет обрезан и синхронизирован под выбранные таймкоды." />
                <PresetInlineAction featureId="clips" />
              </Label>
              <span className="font-mono text-[11px] text-fg-tertiary">
                {fragments.length > 0
                  ? `${fragments.length} ${t("add.clips_selected", { defaultValue: "selected" })}`
                  : t("add.single_range", { defaultValue: "single range" })}
              </span>
            </div>
            {canClips && (
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-fg-tertiary" />
              <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="00:00:00" className="font-mono tabular" />
              <span className="text-fg-tertiary">→</span>
              <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="00:00:00" className="font-mono tabular" />
              <Button size="md" variant="secondary" onClick={addFragment} title="Add clip">
                <ListPlus className="h-3.5 w-3.5" />
                {t("add.add_clip", { defaultValue: "Add clip" })}
              </Button>
            </div>
            )}
            {canClips && !panelCompact("clips") && (
            <div className="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface p-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-secondary">
                  {t("add.bulk_timecodes_title", { defaultValue: "Timecode list" })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addBulkFragments}
                  disabled={!bulkTimecodes.trim()}
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  {t("add.bulk_add_clips", { defaultValue: "Add clips" })}
                </Button>
              </div>
              <textarea
                value={bulkTimecodes}
                onChange={(e) => {
                  setBulkTimecodes(e.target.value);
                  setBulkError(null);
                }}
                placeholder={[
                  "04:18:00 - 04:23:10",
                  "04:24:50 - 04:26:00",
                  "04:26:30 - 04:28:30",
                ].join("\n")}
                className="min-h-24 resize-y rounded border border-border-default bg-canvas px-2 py-1.5 font-mono text-[12px] leading-5 text-fg-primary outline-none placeholder:text-fg-tertiary focus-visible:shadow-focus-ring"
                spellCheck={false}
              />
              {bulkError && (
                <span className="text-[11px] text-danger">{bulkError}</span>
              )}
            </div>
            )}
            {canSplit && (
            <div className="flex items-center justify-between rounded border border-border-subtle bg-surface px-2 py-1.5">
              <label className="flex items-center gap-2 text-[12px] text-fg-secondary">
                <Checkbox
                  checked={split}
                  onCheckedChange={(v) => setSplit(Boolean(v))}
                  disabled={downloadKind === "audio"}
                />
                {t("add.split_per_minute", { defaultValue: "Split into parts (per minute)" })}
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={splitMinutes}
                  onChange={(e) =>
                    setSplitMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                  }
                  disabled={!split}
                  className="h-7 w-16 font-mono text-[12px]"
                />
                <span className="text-[11px] text-fg-tertiary">
                  {t("add.minutes", { defaultValue: "min" })}
                </span>
              </div>
            </div>
            )}
            {fragments.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {fragments.map((fragment, index) => (
                  <div key={fragment.id} className="flex items-center gap-2">
                    <span className="w-8 text-right font-mono text-[11px] text-fg-tertiary">
                      #{index + 1}
                    </span>
                    <Input
                      value={fragment.start}
                      onChange={(e) => updateFragment(fragment.id, "start", e.target.value)}
                      placeholder="00:00:00"
                      className="font-mono tabular"
                    />
                    <span className="text-fg-tertiary">to</span>
                    <Input
                      value={fragment.end}
                      onChange={(e) => updateFragment(fragment.id, "end", e.target.value)}
                      placeholder="00:00:00"
                      className="font-mono tabular"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeFragment(fragment.id)}
                      title="Remove fragment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          <div className="premium-card flex items-center justify-between rounded-lg border border-[#2A3850] px-4 py-3 lg:col-start-1">
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-[12px] text-fg-secondary">
                <Switch checked={isLive && !forceVodMode} onCheckedChange={setIsLive} disabled={forceVodMode} />
                {t("add.live")}
                <InfoTip text={forceVodMode ? "Kick /videos/ ссылки всегда обрабатываются как VOD. Для записи live-чата используй URL канала без /videos/." : "Для архивного Twitch VOD обычно выключено. Включай для реального live-стрима или прямой HLS-ссылки."} />
              </label>
            </div>
          </div>

          {canProxy && (
          <div className="premium-card flex flex-col gap-2 rounded-lg border border-[#2A3850] p-4 lg:col-start-1">
            <Label className="flex items-center gap-1.5">
              {t("add.proxy")}
              <InfoTip text="Прокси нужен только если сервис недоступен напрямую. Медленный прокси замедлит скачивание." />
              <PresetInlineAction featureId="proxy" />
            </Label>
            <div className="flex items-center gap-2">
              <Switch checked={useProxy} onCheckedChange={setUseProxy} />
              <Input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder={t("add.proxy_placeholder")}
                className="font-mono text-[12px]"
                disabled={!useProxy}
              />
            </div>
          </div>
          )}

          <DownloadStartSummary
            downloadChat={downloadChat}
            downloadKind={downloadKind}
            chatOverlay={settings.chatOverlay}
            performance={settings.performance}
            blurZoneCount={blurSponsors ? settings.blurZones.filter((zone) => zone.enabled).length : 0}
            cleanFragments={fragments.length}
            start={start}
            end={end}
            split={split}
            splitMinutes={splitMinutes}
          />
          </section>
        </div>

        <DialogFooter className="premium-stagger premium-stagger-5 border-t border-[#2A3850] bg-[#0C1420]/95 px-5 py-4 shadow-[0_-18px_42px_rgba(0,0,0,0.22)]">
          <Button variant="secondary" onClick={close} className="h-9 min-w-28 border-[#34455F] bg-[#172234] text-[#EAF2FF] hover:bg-[#1C2A40]">
            {t("add.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!url || !name || !directory || submitting}
            className="h-9 min-w-44 bg-[linear-gradient(135deg,#378ADD,#5E5CE6)] text-white shadow-[0_10px_24px_rgba(55,138,221,0.24)] hover:brightness-110"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  );
}

function DownloadStartSummary({
  downloadChat,
  downloadKind,
  chatOverlay,
  performance,
  blurZoneCount,
  cleanFragments,
  start,
  end,
  split,
  splitMinutes,
}: {
  downloadChat: boolean;
  downloadKind: DownloadKind;
  chatOverlay: ChatOverlaySettings;
  performance: PerformanceSettings;
  blurZoneCount: number;
  cleanFragments: number;
  start: string;
  end: string;
  split: boolean;
  splitMinutes: number;
}) {
  const chatEnabled = downloadChat && downloadKind === "video";
  const rangeText =
    cleanFragments > 0
      ? `${cleanFragments} фрагм.`
      : start && end
        ? `${start} - ${end}`
        : "весь доступный диапазон";
  const alphaFormat = chatOverlay.alpha_output_format ?? "mov_qtrle";
  const composeMode = chatOverlay.compose_mode ?? "direct";
  const gpu = performance?.gpu_encoder_mode ?? "auto";
  const network = performance?.network_concurrent_fragments ?? 8;
  const chatFps = chatOverlay.chat_overlay_fps ?? chatOverlay.fps ?? 60;

  return (
    <div className="col-span-12 rounded border border-border-default bg-surface px-3 py-2 text-[11.5px] text-fg-secondary">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-fg-primary">
        Что сделает кнопка запуска
        <InfoTip text="Это краткий план действий. Он меняется в зависимости от выбранных настроек перед нажатием Скачать." />
      </div>
      <div className="grid gap-1">
        <span>1. Поставит задание в очередь и скачает исходное видео: {rangeText}.</span>
        <span>2. Использует сетевые потоки: {network}; кодер финального MP4: {gpuLabel(gpu)}.</span>
        {chatEnabled ? (
          <>
            <span>3. Скачает replay-чата и синхронизирует его с таймкодами видео.</span>
            <span>
              4. Отрендерит чат: {chatFps} FPS, режим {composeModeLabel(composeMode)}, alpha {alphaLabel(alphaFormat)}.
            </span>
            <span>
              5. Сохранит файлы: чистое видео, прозрачный чат `*_chat_overlay.{alphaFormat === "mov_qtrle" ? "mov" : "webm"}` и итоговое `*_chat.mp4`.
            </span>
            {blurZoneCount > 0 && (
              <span>6. Применит зон блюра/картинок: {blurZoneCount}. Картинки с режимом Contain сохраняют пропорции.</span>
            )}
          </>
        ) : (
          <span>3. Чат выключен: будет сохранено только чистое видео без overlay.</span>
        )}
        {split && (
          <span>После сборки файл будет нарезан на части по {splitMinutes} мин.</span>
        )}
      </div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-elevated text-fg-tertiary hover:text-fg-primary"
          aria-label="Подсказка"
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-4">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function gpuLabel(value: string) {
  switch (value) {
    case "intel_xe_qsv":
      return "Intel Xe QSV";
    case "qsv":
      return "Intel QSV";
    case "nvenc":
      return "NVIDIA NVENC";
    case "amf":
      return "AMD AMF";
    case "cpu":
      return "CPU libx264";
    default:
      return "Auto";
  }
}

function composeModeLabel(value: string) {
  return value === "intermediate" ? "intermediate overlay" : "direct compose";
}

function alphaLabel(value: string) {
  switch (value) {
    case "webm_vp9":
      return "WebM VP9";
    case "webm_vp8":
      return "WebM VP8";
    default:
      return "MOV qtrle";
  }
}

function twitchVodChatSourceUrl(input: string): string | null {
  const trimmed = input.trim();
  return /(?:^https?:\/\/)?(?:www\.)?twitch\.tv\/(?:videos|video|v)\/\d+/i.test(trimmed) ? trimmed : null;
}
