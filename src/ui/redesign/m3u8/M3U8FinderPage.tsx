import { useEffect, useMemo, useState } from "react";

import { usePersistedState } from "@/hooks/usePersistedState";
import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import type { TwitchPublicVod, TwitchPublicVodPage } from "@/services/m3u8/m3u8DiscoveryTypes";
import { recoverM3u8FromTrackerMeta } from "@/services/m3u8/m3u8RecoveryService";
import { discoverTrackerMetadata } from "@/services/m3u8/trackerDiscoveryService";
import { fetchPublicTwitchVods } from "@/services/twitch/twitchVodService";
import { defaultPerformanceSettings, useSettings } from "@/stores/settings";
import { useWorkflowPresets } from "@/stores/workflowPresets";
import type { JobSpec, TwitchStreamListItem, TwitchStreamsPage } from "@/types/job";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import { M3U8AnalysisStatus, type M3U8AnalysisStats, type M3U8AnalysisStep } from "./M3U8AnalysisStatus";
import styles from "./M3U8FinderPage.module.css";
import { M3U8RecoveredResultsTable, type M3U8RecoveredResultRow } from "./M3U8RecoveredResultsTable";
import { M3U8SearchParamsCard } from "./M3U8SearchParamsCard";
import { PublicVodSearchPanel } from "./PublicVodSearchPanel";
import { TrackerFallbackPanel } from "./TrackerFallbackPanel";
import { VodResultsTable, type FinderStreamRow } from "./VodResultsTable";

const STREAM_PAGE_SIZE = 5;

export function M3U8FinderPage() {
  const settings = useSettings();
  const m3u8Presets = useWorkflowPresets((state) => state.m3u8Presets);
  const activeM3u8PresetId = useWorkflowPresets((state) => state.activeM3u8PresetId);
  const createM3u8Preset = useWorkflowPresets((state) => state.createM3u8Preset);
  const updateM3u8Preset = useWorkflowPresets((state) => state.updateM3u8Preset);
  const rememberM3u8Streamer = useWorkflowPresets((state) => state.rememberM3u8Streamer);
  const activeM3u8Preset = m3u8Presets.find((preset) => preset.id === activeM3u8PresetId) ?? null;

  const [publicVodLogin, setPublicVodLogin] = usePersistedState("fetchr-draft:m3u8:publicVodLogin", "");
  const [publicVodLoading, setPublicVodLoading] = useState(false);
  const [publicVodError, setPublicVodError] = useState<string | null>(null);
  const [publicVodPage, setPublicVodPage] = usePersistedState<TwitchPublicVodPage | null>("fetchr-draft:m3u8:publicVodPage", null);
  const [trackerStreamsPage, setTrackerStreamsPage] = usePersistedState<TwitchStreamsPage | null>("fetchr-draft:m3u8:trackerStreamsPage", null);
  const [trackerStreamsError, setTrackerStreamsError] = useState<string | null>(null);
  const [streamPage, setStreamPage] = usePersistedState("fetchr-draft:m3u8:streamPage", 1);
  const [copiedStreamId, setCopiedStreamId] = useState<string | null>(null);
  const [queuedStreamId, setQueuedStreamId] = useState<string | null>(null);
  const [generatingStreamId, setGeneratingStreamId] = useState<string | null>(null);

  const [trackerUrl, setTrackerUrl] = usePersistedState("fetchr-draft:m3u8:trackerUrl", "");
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [username, setUsername] = usePersistedState("fetchr-draft:m3u8:username", "");
  const [streamId, setStreamId] = usePersistedState("fetchr-draft:m3u8:streamId", "");
  const [startTime, setStartTime] = usePersistedState("fetchr-draft:m3u8:startTime", "");
  const [candidates, setCandidates] = usePersistedState<string[]>("fetchr-draft:m3u8:candidates", []);

  const [recoveredLoading, setRecoveredLoading] = useState(false);
  const [recoveredError, setRecoveredError] = useState<string | null>(null);
  const [recoveredRows, setRecoveredRows] = usePersistedState<M3U8RecoveredResultRow[]>("fetchr-draft:m3u8:recoveredRows", []);
  const [checkedCandidates, setCheckedCandidates] = usePersistedState("fetchr-draft:m3u8:checkedCandidates", 0);
  const [queuedRecoveredUrl, setQueuedRecoveredUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeM3u8Preset) return;
    setPublicVodLogin(activeM3u8Preset.streamer);
    setUsername(activeM3u8Preset.streamer);
  }, [activeM3u8Preset?.id]);

  useEffect(() => {
    let cancelled = false;
    const value = trackerUrl.trim();
    if (!value) return;

    void (async () => {
      try {
        const hint = await ipc.twitchParseUrl(value);
        if (cancelled) return;
        if (hint.username && !username) setUsername(hint.username);
        if (hint.stream_id && !streamId) setStreamId(hint.stream_id);
      } catch {
        /* best effort hint only */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streamId, trackerUrl, username]);

  const streamRows = useMemo(
    () => buildStreamRows(trackerStreamsPage, publicVodPage),
    [publicVodPage, trackerStreamsPage],
  );

  const loadPublicVods = async (loginOverride?: string) => {
    const login = (loginOverride ?? publicVodLogin).trim().replace(/^@/, "");
    if (!login) {
      setPublicVodError("Введите ник Twitch-стримера.");
      setPublicVodPage(null);
      setTrackerStreamsPage(null);
      return;
    }

    setPublicVodLoading(true);
    setPublicVodError(null);
    setTrackerStreamsError(null);
    setActionError(null);
    try {
      const [publicResult, trackerResult] = await Promise.allSettled([
        fetchPublicTwitchVods({ login, first: 100, cursor: null }),
        ipc.twitchTrackerStreams({ username: login, page: 1, page_size: STREAM_PAGE_SIZE }),
      ]);

      if (publicResult.status === "fulfilled") {
        setPublicVodPage(publicResult.value);
        setPublicVodLogin(publicResult.value.broadcaster.login);
        if (activeM3u8PresetId) rememberM3u8Streamer(activeM3u8PresetId, publicResult.value.broadcaster.login);
      } else {
        setPublicVodError(String(publicResult.reason));
        setPublicVodPage(null);
      }

      if (trackerResult.status === "fulfilled") {
        setTrackerStreamsPage(trackerResult.value);
        setStreamPage(trackerResult.value.page);
        setUsername(trackerResult.value.username);
      } else {
        setTrackerStreamsError(String(trackerResult.reason));
        setTrackerStreamsPage(null);
        setStreamPage(1);
      }
    } finally {
      setPublicVodLoading(false);
    }
  };

  const loadStreamPage = async (page: number) => {
    const login = (trackerStreamsPage?.username || publicVodLogin).trim().replace(/^@/, "");
    if (!login || page < 1) return;
    setPublicVodLoading(true);
    setTrackerStreamsError(null);
    try {
      const data = await ipc.twitchTrackerStreams({ username: login, page, page_size: STREAM_PAGE_SIZE });
      setTrackerStreamsPage(data);
      setStreamPage(data.page);
      setUsername(data.username);
    } catch (error) {
      setTrackerStreamsError(String(error));
    } finally {
      setPublicVodLoading(false);
    }
  };

  const saveActiveM3u8Preset = () => {
    const streamer = publicVodLogin.trim().replace(/^@/, "");
    const id = activeM3u8PresetId ?? createM3u8Preset(null);
    updateM3u8Preset(id, {
      streamer,
      name: activeM3u8Preset?.name?.trim() || (streamer ? `M3U8 ${streamer}` : "M3U8 preset"),
    });
    if (streamer) rememberM3u8Streamer(id, streamer);
  };

  const reloadActiveM3u8Preset = () => {
    if (activeM3u8Preset?.streamer) {
      setPublicVodLogin(activeM3u8Preset.streamer);
      setUsername(activeM3u8Preset.streamer);
      void loadPublicVods(activeM3u8Preset.streamer);
      return;
    }
    void loadPublicVods();
  };

  const copyPublicVodUrl = async (vod: TwitchPublicVod) => {
    try {
      await copyText(vod.url);
      setCopiedStreamId(`public:${vod.id}`);
      window.setTimeout(() => setCopiedStreamId(null), 1500);
      setActionError(null);
    } catch (error) {
      setActionError(`Не удалось скопировать Twitch URL: ${String(error)}`);
    }
  };

  const addPublicVodToQueue = async (vod: TwitchPublicVod) => {
    if (!vod.public) return;
    setActionError(null);
    const directory = await resolveQueueDirectory(settings.directory);
    const spec: JobSpec = {
      url: vod.url,
      chat_source_url: vod.url,
      name: vod.title || `twitch_vod_${vod.id}`,
      directory,
      job_kind: "video",
      mode: "vod",
      download_kind: "video",
      start: null,
      end: null,
      fragments: [],
      split: false,
      split_interval_minutes: null,
      quality: null,
      quality_has_audio: null,
      quality_has_video: null,
      unmute_video: false,
      proxy: settings.proxy,
      chat_overlay: { ...settings.chatOverlay, enabled: false },
      performance: settings.performance ?? defaultPerformanceSettings,
      blur_zones: [],
      binaries_dir: settings.binariesDir,
      meta: {
        platform: "twitch",
        title: vod.title,
        uploader: publicVodLogin || username || null,
        thumbnail: vod.thumbnailUrl,
        duration: vod.durationSeconds,
      },
    };
    await StreamDownloader.enqueue(spec);
    setQueuedStreamId(`public:${vod.id}`);
    window.setTimeout(() => setQueuedStreamId(null), 1500);
  };

  const copyRecoveredFromStream = async (row: FinderStreamRow) => {
    const url = await recoverFirstM3u8ForRow(row);
    if (!url) return;
    await copyText(url);
    setCopiedStreamId(row.id);
    window.setTimeout(() => setCopiedStreamId(null), 1500);
  };

  const addRecoveredStreamToQueue = async (row: FinderStreamRow) => {
    const url = await recoverFirstM3u8ForRow(row);
    if (!url) return;
    await addRecoveredToQueue(url, row);
    setQueuedStreamId(row.id);
    window.setTimeout(() => setQueuedStreamId(null), 1500);
  };

  const recoverFirstM3u8ForRow = async (row: FinderStreamRow): Promise<string | null> => {
    if (!row.streamId || !row.createdAt) {
      setActionError("Для recovered m3u8 нужен stream_id и время начала.");
      return null;
    }
    setGeneratingStreamId(row.id);
    setActionError(null);
    setRecoveredError(null);
    try {
      setUsername(row.username);
      setStreamId(row.streamId);
      setStartTime(isoUtcToLocalInput(row.createdAt));
      const recovered = await recoverM3u8FromTrackerMeta({
        username: row.username,
        streamId: row.streamId,
        startTime: row.createdAt,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        candidates: [],
      });
      setCheckedCandidates(recovered.tried);
      const rows = recovered.urls.map((item) => ({
        url: item.url,
        bitrate: "Не определено",
        resolution: "Не определено",
        duration: row.duration || "Не определено",
        status: "Доступен",
      }));
      setRecoveredRows(rows);
      if (!rows[0]) {
        setRecoveredError("Публично доступные recovered m3u8 не найдены.");
        return null;
      }
      return rows[0].url;
    } catch (error) {
      setRecoveredError(String(error));
      return null;
    } finally {
      setGeneratingStreamId(null);
    }
  };

  const pasteTrackerUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTrackerUrl(text);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const fetchTrackerMetadata = async () => {
    if (!trackerUrl.trim()) return;
    setTrackerLoading(true);
    setTrackerError(null);
    setRecoveredError(null);
    try {
      const meta = await discoverTrackerMetadata({
        sourceUrl: trackerUrl,
        username,
        streamId,
        startTime,
      });
      if (meta.username) setUsername(meta.username);
      if (meta.streamId) setStreamId(meta.streamId);
      if (meta.startTime) setStartTime(isoUtcToLocalInput(meta.startTime));
      setCandidates((meta.candidates ?? []).map(isoUtcToLocalInput));
      if (!meta.startTime) {
        setTrackerError("Не удалось определить время начала. Заполните его вручную.");
      }
    } catch (error) {
      setTrackerError(String(error));
    } finally {
      setTrackerLoading(false);
    }
  };

  const findRecoveredM3u8 = async () => {
    if (!username.trim() || !streamId.trim() || !startTime.trim()) return;
    setRecoveredLoading(true);
    setRecoveredError(null);
    setRecoveredRows([]);
    setCheckedCandidates(0);
    try {
      const meta = await discoverTrackerMetadata({
        sourceUrl: trackerUrl.trim() || undefined,
        username: username.trim(),
        streamId: streamId.trim(),
        startTime: startTime.trim(),
      });

      const recoveryMeta = {
        ...meta,
        username: meta.username ?? username.trim(),
        streamId: meta.streamId ?? streamId.trim(),
        startTime: meta.startTime ?? startTime.trim(),
      };

      if (recoveryMeta.username) setUsername(recoveryMeta.username);
      if (recoveryMeta.streamId) setStreamId(recoveryMeta.streamId);
      if (recoveryMeta.startTime && trackerUrl.trim()) setStartTime(isoUtcToLocalInput(recoveryMeta.startTime));
      if (meta.candidates.length > 0) setCandidates(meta.candidates.map(isoUtcToLocalInput));

      const recovered = await recoverM3u8FromTrackerMeta(recoveryMeta);
      setCheckedCandidates(recovered.tried);
      setRecoveredRows(
        recovered.urls.map((item) => ({
          url: item.url,
          bitrate: "Не определено",
          resolution: "Не определено",
          duration: "Не определено",
          status: "Доступен",
        })),
      );
      if (recovered.urls.length === 0) {
        setRecoveredError("Публично доступные recovered m3u8 не найдены.");
      }
    } catch (error) {
      setRecoveredError(String(error));
    } finally {
      setRecoveredLoading(false);
    }
  };

  const copyRecoveredUrl = async (index: number) => {
    const row = recoveredRows[index];
    if (!row) return;
    try {
      await copyText(row.url);
      setRecoveredRows((rows) => rows.map((item, idx) => (idx === index ? { ...item, copied: true } : item)));
      window.setTimeout(() => {
        setRecoveredRows((rows) => rows.map((item, idx) => (idx === index ? { ...item, copied: false } : item)));
      }, 1500);
      setActionError(null);
    } catch (error) {
      setActionError(`Не удалось скопировать m3u8 URL: ${String(error)}`);
    }
  };

  const addRecoveredToQueue = async (url: string, row?: FinderStreamRow) => {
    setActionError(null);
    const directory = await resolveQueueDirectory(settings.directory);
    const spec: JobSpec = {
      url,
      name: `${row?.username || username || "stream"}_${row?.streamId || streamId || Date.now()}`,
      directory,
      job_kind: "video",
      mode: "vod",
      download_kind: "video",
      start: null,
      end: null,
      fragments: [],
      split: false,
      split_interval_minutes: null,
      quality: null,
      quality_has_audio: null,
      quality_has_video: null,
      unmute_video: false,
      proxy: settings.proxy,
      chat_overlay: { ...settings.chatOverlay, enabled: false },
      performance: settings.performance ?? defaultPerformanceSettings,
      blur_zones: [],
      binaries_dir: settings.binariesDir,
      meta: {
        platform: "hls",
        title: row?.title || `${username} · ${streamId}`,
        uploader: row?.username || username || null,
        thumbnail: row?.thumbnailUrl ?? null,
      },
    };
    await StreamDownloader.enqueue(spec);
    setQueuedRecoveredUrl(url);
    window.setTimeout(() => setQueuedRecoveredUrl(null), 1500);
  };

  const errorCount =
    Number(Boolean(publicVodError)) +
    Number(Boolean(trackerError)) +
    Number(Boolean(trackerStreamsError)) +
    Number(Boolean(recoveredError));
  const stats = useMemo<M3U8AnalysisStats>(
    () => ({
      publicVodCount: streamRows.length || publicVodPage?.items.length || 0,
      checkedCandidates,
      recoveredCount: recoveredRows.length,
      queueReadyCount: streamRows.length + recoveredRows.length,
      errorCount,
    }),
    [checkedCandidates, errorCount, publicVodPage?.items.length, recoveredRows.length, streamRows.length],
  );

  const steps = useMemo<M3U8AnalysisStep[]>(
    () => [
      {
        title: "Загрузка списка стримов",
        detail: streamRows.length ? `Показано (${streamRows.length})` : "Ожидает никнейм Twitch",
        done: streamRows.length > 0,
        active: publicVodLoading,
      },
      {
        title: "Tracker metadata",
        detail: username && streamId ? "Метаданные получены или введены вручную" : "Ожидает источник",
        done: Boolean(username && streamId),
        active: trackerLoading,
      },
      {
        title: "Поиск m3u8 плейлистов",
        detail: recoveredRows.length ? `Успешно (${recoveredRows.length})` : "Генерируется только для скрытых/удалённых",
        done: recoveredRows.length > 0,
        active: recoveredLoading || Boolean(generatingStreamId),
      },
      {
        title: "Готово к скачиванию",
        detail: "Public: Twitch VOD URL. Hidden/deleted: video-only m3u8.",
        done: stats.queueReadyCount > 0,
      },
    ],
    [generatingStreamId, publicVodLoading, recoveredLoading, recoveredRows.length, stats.queueReadyCount, streamId, streamRows.length, trackerLoading, username],
  );

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>M3U8 Finder</h1>
        <span className={styles.subtitle}>Public VOD + hidden/deleted recovered m3u8</span>
      </header>

      <div className={styles.inputs}>
        <div className={styles.stack}>
          <PublicVodSearchPanel
            login={publicVodLogin}
            loading={publicVodLoading}
            error={publicVodError}
            page={publicVodPage}
            presetName={activeM3u8Preset?.name ?? null}
            presetHistory={activeM3u8Preset?.history ?? []}
            onLoginChange={setPublicVodLogin}
            onSearch={() => void loadPublicVods()}
            onSavePreset={saveActiveM3u8Preset}
            onReloadPreset={reloadActiveM3u8Preset}
          />
          <VodResultsTable
            page={publicVodPage}
            rows={streamRows}
            loading={publicVodLoading}
            copiedId={copiedStreamId}
            queuedId={queuedStreamId}
            generatingId={generatingStreamId}
            streamPage={streamPage}
            totalStreams={trackerStreamsPage?.total ?? streamRows.length}
            pageSize={STREAM_PAGE_SIZE}
            trackerError={trackerStreamsError}
            onCopyPublic={(vod) => void copyPublicVodUrl(vod)}
            onAddPublicToQueue={(vod) => void addPublicVodToQueue(vod)}
            onCopyRecovered={(row) => void copyRecoveredFromStream(row)}
            onAddRecoveredToQueue={(row) => void addRecoveredStreamToQueue(row)}
            onPageChange={(page) => void loadStreamPage(page)}
          />
        </div>

        <div className={styles.stack}>
          <TrackerFallbackPanel
            sourceUrl={trackerUrl}
            loading={trackerLoading}
            error={trackerError}
            onSourceUrlChange={setTrackerUrl}
            onPaste={() => void pasteTrackerUrl()}
            onFetchMetadata={() => void fetchTrackerMetadata()}
          />
          <M3U8SearchParamsCard
            username={username}
            streamId={streamId}
            startTime={startTime}
            candidates={candidates}
            loading={recoveredLoading}
            onUsernameChange={setUsername}
            onStreamIdChange={setStreamId}
            onStartTimeChange={setStartTime}
            onSearch={() => void findRecoveredM3u8()}
          />
        </div>
      </div>

      <div className={styles.results}>
        {actionError && <div className={styles.errorBox}>{actionError}</div>}
        {recoveredError && <div className={styles.errorBox}>{recoveredError}</div>}
        <M3U8RecoveredResultsTable
          rows={recoveredRows}
          loading={recoveredLoading || Boolean(generatingStreamId)}
          tried={checkedCandidates}
          queuedUrl={queuedRecoveredUrl}
          canRefresh={Boolean(username.trim() && streamId.trim() && startTime.trim())}
          onCopy={(index) => void copyRecoveredUrl(index)}
          onAddVideoOnlyTask={(url) => void addRecoveredToQueue(url)}
          onRefresh={() => void findRecoveredM3u8()}
        />
      </div>

      <div className={styles.statusArea}>
        <M3U8AnalysisStatus stats={stats} steps={steps} />
      </div>
    </div>
  );
}

function buildStreamRows(trackerPage: TwitchStreamsPage | null, publicPage: TwitchPublicVodPage | null): FinderStreamRow[] {
  const publicByStreamId = new Map<string, TwitchPublicVod>();
  const publicByDateTitle = new Map<string, TwitchPublicVod>();
  for (const vod of publicPage?.items ?? []) {
    if (vod.streamId) publicByStreamId.set(vod.streamId, vod);
    publicByDateTitle.set(normalizeMatchKey(vod.createdAt, vod.title), vod);
  }

  if (trackerPage?.items.length) {
    return trackerPage.items.map((item, index) => {
      const publicVod =
        (item.stream_id ? publicByStreamId.get(item.stream_id) : undefined) ??
        publicByDateTitle.get(normalizeMatchKey(item.start_time || item.date, item.title));
      if (publicVod) return publicVodToRow(publicVod, trackerPage.username);
      return trackerItemToRow(item, trackerPage.username, index);
    });
  }

  return (publicPage?.items ?? []).slice(0, STREAM_PAGE_SIZE).map((vod) => publicVodToRow(vod, publicPage?.broadcaster.login ?? "twitch"));
}

function publicVodToRow(vod: TwitchPublicVod, username: string): FinderStreamRow {
  return {
    id: `public:${vod.id}`,
    kind: "public",
    title: vod.title || `Twitch VOD ${vod.id}`,
    username,
    streamId: vod.streamId,
    createdAt: vod.createdAt,
    duration: vod.duration || "-",
    thumbnailUrl: vod.thumbnailUrl,
    twitchUrl: vod.url,
    trackerUrl: vod.streamId ? `https://twitchtracker.com/${username}/streams/${vod.streamId}` : null,
    chatAvailable: vod.chatAvailable,
    publicVod: vod,
  };
}

function trackerItemToRow(item: TwitchStreamListItem, username: string, index: number): FinderStreamRow {
  return {
    id: `tracker:${item.stream_id ?? item.start_time ?? item.date ?? index}`,
    kind: "tracker",
    title: item.title || "Скрытый / удалённый стрим",
    username,
    streamId: item.stream_id,
    createdAt: item.start_time || item.date,
    duration: item.duration_minutes != null ? formatMinutes(item.duration_minutes) : "-",
    thumbnailUrl: null,
    twitchUrl: null,
    trackerUrl: item.url,
    chatAvailable: false,
  };
}

function normalizeMatchKey(dateValue?: string | null, title?: string | null): string {
  const time = dateValue ? Math.floor(new Date(dateValue).getTime() / 60000) : 0;
  return `${Number.isFinite(time) ? time : 0}:${(title ?? "").trim().toLowerCase()}`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function isoUtcToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard command rejected");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

async function resolveQueueDirectory(current: string): Promise<string> {
  const directory = current.trim();
  if (directory) return directory;
  const fallback = await ipc.defaultDownloadDir();
  if (!fallback) {
    throw new Error("Не выбрана папка сохранения.");
  }
  return fallback;
}
