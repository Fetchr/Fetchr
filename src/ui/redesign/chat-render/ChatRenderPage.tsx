import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { usePersistedState } from "@/hooks/usePersistedState";
import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import { detectPlatform } from "@/lib/url";
import { renderKickNormalizedChatJson } from "@/services/chat";
import {
  discoverKickChatReplaySource,
  exportKickChatJson,
  KICK_CHAT_REPLAY_UNAVAILABLE,
  resolveKickMetadata,
  type KickNormalizedChatMessage,
} from "@/services/kick";
import { defaultChatOverlaySettings, useSettings } from "@/stores/settings";
import { useWorkflowPresets } from "@/stores/workflowPresets";
import type {
  AlphaOutputFormat,
  ChatComposeMode,
  ChatFontStyle,
  ChatOverlayMode,
  ChatRenderCodec,
  SystemFont,
} from "@/types/job";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./ChatRenderPage.module.css";
import { ChatExportSettings, type ChatOutputFormat } from "./ChatExportSettings";
import { ChatFrameSourceCard, type FrameSourceMode } from "./ChatFrameSourceCard";
import { ChatOnlyExportPanel } from "./ChatOnlyExportPanel";
import { type ChatPlatform } from "./ChatPlatformSelector";
import { ChatPositionPanel } from "./ChatPositionPanel";
import { ChatResultPreview } from "./ChatResultPreview";

export function ChatRenderPage() {
  const settings = useSettings();
  const chatPresets = useWorkflowPresets((state) => state.chatPresets);
  const activeChatPresetId = useWorkflowPresets((state) => state.activeChatPresetId);
  const setActiveChatPreset = useWorkflowPresets((state) => state.setActiveChatPreset);
  const createChatPreset = useWorkflowPresets((state) => state.createChatPreset);
  const saveChatPreset = useWorkflowPresets((state) => state.saveChatPreset);
  const renameChatPreset = useWorkflowPresets((state) => state.renameChatPreset);
  const activeChatPreset = chatPresets.find((preset) => preset.id === activeChatPresetId) ?? chatPresets[0] ?? null;
  const chat = { ...defaultChatOverlaySettings, ...settings.chatOverlay };

  const [draftPresetId, setDraftPresetId] = usePersistedState("fetchr-draft:chatRender:presetId", "");
  const [platform, setPlatform] = usePersistedState<ChatPlatform>("fetchr-draft:chatRender:platform", "twitch");
  const [sourceUrl, setSourceUrl] = usePersistedState("fetchr-draft:chatRender:sourceUrl", "");
  const [start, setStart] = usePersistedState("fetchr-draft:chatRender:start", "");
  const [end, setEnd] = usePersistedState("fetchr-draft:chatRender:end", "");
  const [fileName, setFileName] = usePersistedState("fetchr-draft:chatRender:fileName", "stream_chat");
  const [directory, setDirectory] = usePersistedState("fetchr-draft:chatRender:directory", settings.directory);
  const [frameMode, setFrameMode] = usePersistedState<FrameSourceMode>("fetchr-draft:chatRender:frameMode", "url");
  const [screenshotUrl, setScreenshotUrl] = usePersistedState("fetchr-draft:chatRender:screenshotUrl", "");
  const [frameUrl, setFrameUrl] = usePersistedState<string | null>("fetchr-draft:chatRender:frameUrl", null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"json" | "render" | "queue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kickMessages, setKickMessages] = useState<KickNormalizedChatMessage[] | null>(null);
  const [kickWarning, setKickWarning] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = usePersistedState<ChatOutputFormat>("fetchr-draft:chatRender:outputFormat", "mov");
  const [codec, setCodecState] = usePersistedState<ChatRenderCodec>("fetchr-draft:chatRender:codec", (chat.render_codec ?? "qtrle_mov_rle") as ChatRenderCodec);
  const [overlayMode, setOverlayMode] = usePersistedState<ChatOverlayMode>("fetchr-draft:chatRender:overlayMode", (chat.mode ?? "direct_render") as ChatOverlayMode);
  const [composeMode, setComposeMode] = usePersistedState<ChatComposeMode>("fetchr-draft:chatRender:composeMode", (chat.compose_mode ?? "direct") as ChatComposeMode);
  const [alphaOutputFormat, setAlphaOutputFormat] = usePersistedState<AlphaOutputFormat>("fetchr-draft:chatRender:alphaOutputFormat", (chat.alpha_output_format ?? "mov_qtrle") as AlphaOutputFormat);
  const [solidBackgroundColor, setSolidBackgroundColor] = usePersistedState("fetchr-draft:chatRender:solidBackgroundColor", chat.solid_background_color ?? "#212121");
  const [alphaBackground, setAlphaBackground] = usePersistedState("fetchr-draft:chatRender:alphaBackground", Boolean(chat.save_alpha_overlay ?? true));
  const [fontFamily, setFontFamily] = usePersistedState("fetchr-draft:chatRender:fontFamily", chat.font_family ?? "Inter");
  const [fontStyle, setFontStyle] = usePersistedState<ChatFontStyle>("fetchr-draft:chatRender:fontStyle", (chat.font_style ?? "normal") as ChatFontStyle);
  const [fontSize, setFontSize] = usePersistedState("fetchr-draft:chatRender:fontSize", chat.font_size ?? 24);
  const [fontWeight, setFontWeight] = usePersistedState("fetchr-draft:chatRender:fontWeight", chat.font_weight ?? 400);
  const [usernameFontWeight, setUsernameFontWeight] = usePersistedState("fetchr-draft:chatRender:usernameFontWeight", chat.username_font_weight ?? 700);
  const textColor = chat.text_color ?? "#FFFFFF";
  const outlineEnabled = Boolean(chat.outline_enabled ?? true);
  const outlineColor = chat.outline_color ?? "#000000";
  const outlineThickness = chat.outline_thickness ?? 2;
  const [backgroundEnabled, setBackgroundEnabled] = usePersistedState("fetchr-draft:chatRender:backgroundEnabled", Boolean(chat.background_enabled ?? false));
  const [backgroundOpacity, setBackgroundOpacity] = usePersistedState("fetchr-draft:chatRender:backgroundOpacity", chat.background_opacity ?? 0.15);
  const [showBadges, setShowBadges] = usePersistedState("fetchr-draft:chatRender:showBadges", Boolean(chat.show_badges ?? true));
  const [showTimestamps, setShowTimestamps] = usePersistedState("fetchr-draft:chatRender:showTimestamps", Boolean(chat.show_timestamps ?? false));
  const [showAvatars, setShowAvatars] = usePersistedState("fetchr-draft:chatRender:showAvatars", Boolean(chat.show_avatars ?? false));
  const [showBttv, setShowBttv] = usePersistedState("fetchr-draft:chatRender:showBttv", Boolean(chat.show_bttv ?? true));
  const [showFfz, setShowFfz] = usePersistedState("fetchr-draft:chatRender:showFfz", Boolean(chat.show_ffz ?? true));
  const [show7tv, setShow7tv] = usePersistedState("fetchr-draft:chatRender:show7tv", Boolean(chat.show_7tv ?? true));
  const [saveCleanVideo, setSaveCleanVideo] = usePersistedState("fetchr-draft:chatRender:saveCleanVideo", Boolean(chat.save_clean_video ?? true));
  const [cacheRemoteEmotes, setCacheRemoteEmotes] = usePersistedState("fetchr-draft:chatRender:cacheRemoteEmotes", Boolean(settings.integrations.cacheRemoteEmotes ?? true));
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [preserveRatio, setPreserveRatio] = usePersistedState("fetchr-draft:chatRender:preserveRatio", true);
  const [placement, setPlacement] = usePersistedState("fetchr-draft:chatRender:placement", {
    x: chat.chat_x ?? 80,
    y: chat.chat_y ?? 760,
    width: chat.chat_width ?? 1760,
    height: chat.chat_height ?? 260,
    outputWidth: chat.output_width ?? 1920,
    outputHeight: chat.output_height ?? 1080,
  });

  const updatePlacement = (next: typeof placement) => {
    setPlacement(normalizePlacement(next));
  };

  useEffect(() => {
    void ipc.listSystemFonts()
      .then((fonts) => {
        setSystemFonts(fonts);
        const current =
          fonts.find((font) => font.family === fontFamily) ??
          fonts.find((font) => font.family === "Segoe UI") ??
          fonts[0];
        if (current && !fonts.some((font) => font.family === fontFamily)) {
          setFontFamily(current.family);
        }
      })
      .catch(() => setSystemFonts([]));
  }, [fontFamily]);

  useEffect(() => {
    if (!activeChatPreset) return;
    if (draftPresetId === activeChatPresetId) return;
    setDraftPresetId(activeChatPresetId);
    const overlay = { ...defaultChatOverlaySettings, ...activeChatPreset.overlay };
    setCodecState((overlay.render_codec ?? "qtrle_mov_rle") as ChatRenderCodec);
    setOverlayMode((overlay.mode ?? "direct_render") as ChatOverlayMode);
    setComposeMode((overlay.compose_mode ?? "direct") as ChatComposeMode);
    setAlphaOutputFormat((overlay.alpha_output_format ?? "mov_qtrle") as AlphaOutputFormat);
    setSolidBackgroundColor(overlay.solid_background_color ?? "#212121");
    setAlphaBackground(Boolean(overlay.save_alpha_overlay ?? true));
    setFontFamily(overlay.font_family ?? "Inter");
    setFontStyle((overlay.font_style ?? "normal") as ChatFontStyle);
    setFontSize(overlay.font_size ?? 24);
    setFontWeight(overlay.font_weight ?? 400);
    setUsernameFontWeight(overlay.username_font_weight ?? 700);
    setBackgroundEnabled(Boolean(overlay.background_enabled ?? false));
    setBackgroundOpacity(overlay.background_opacity ?? 0.15);
    setShowBadges(Boolean(overlay.show_badges ?? true));
    setShowTimestamps(Boolean(overlay.show_timestamps ?? false));
    setShowAvatars(Boolean(overlay.show_avatars ?? false));
    setShowBttv(Boolean(overlay.show_bttv ?? true));
    setShowFfz(Boolean(overlay.show_ffz ?? true));
    setShow7tv(Boolean(overlay.show_7tv ?? true));
    setSaveCleanVideo(Boolean(overlay.save_clean_video ?? true));
    setPlacement((current) => normalizePlacement({
      ...current,
      x: overlay.chat_x ?? current.x,
      y: overlay.chat_y ?? current.y,
      width: overlay.chat_width ?? current.width,
      height: overlay.chat_height ?? current.height,
      outputWidth: overlay.output_width ?? current.outputWidth,
      outputHeight: overlay.output_height ?? current.outputHeight,
    }));
  }, [activeChatPreset, activeChatPresetId, draftPresetId, setDraftPresetId]);

  const chatOverlay = useMemo(() => ({
    ...chat,
    enabled: true,
    output_width: placement.outputWidth,
    output_height: placement.outputHeight,
    fps: chat.fps ?? 60,
    chat_overlay_fps: chat.chat_overlay_fps ?? chat.fps ?? 60,
    chat_x: placement.x,
    chat_y: placement.y,
    chat_width: placement.width,
    chat_height: placement.height,
    mode: overlayMode,
    compose_mode: composeMode,
    render_codec: codec,
    alpha_output_format: alphaOutputFormat,
    solid_background_color: solidBackgroundColor,
    save_alpha_overlay: alphaBackground,
    save_clean_video: saveCleanVideo,
    font_family: fontFamily,
    font_style: fontStyle,
    font_size: fontSize,
    font_weight: fontWeight,
    username_font_weight: usernameFontWeight,
    username_font_style: fontStyle,
    text_color: textColor,
    outline_enabled: outlineEnabled,
    outline_color: outlineColor,
    outline_thickness: outlineThickness,
    background_enabled: backgroundEnabled,
    background_opacity: backgroundOpacity,
    max_visible_messages: 999,
    message_lifetime_sec: 86400,
    show_badges: showBadges,
    show_timestamps: showTimestamps,
    show_avatars: showAvatars,
    show_bttv: showBttv,
    show_ffz: showFfz,
    show_7tv: show7tv,
  }), [
    alphaBackground,
    alphaOutputFormat,
    backgroundEnabled,
    backgroundOpacity,
    chat,
    codec,
    composeMode,
    fontFamily,
    fontSize,
    fontStyle,
    fontWeight,
    overlayMode,
    outlineColor,
    outlineEnabled,
    outlineThickness,
    placement,
    saveCleanVideo,
    show7tv,
    showAvatars,
    showBadges,
    showBttv,
    showFfz,
    showTimestamps,
    solidBackgroundColor,
    textColor,
    usernameFontWeight,
  ]);

  const chooseDirectory = async () => {
    const path = await ipc.chooseDirectory();
    if (path) {
      setDirectory(path);
      settings.setDirectory(path);
    }
  };

  const pasteScreenshot = async () => {
    try {
      setScreenshotUrl(await navigator.clipboard.readText());
    } catch {
      /* noop */
    }
  };

  const updatePreview = async () => {
    setFrameLoading(true);
    setFrameError(null);
    try {
      if (frameMode === "url") {
        if (!screenshotUrl.trim()) throw new Error("Вставьте ссылку на изображение.");
        const frame = await ipc.validateChatRenderScreenshotUrl(screenshotUrl.trim());
        setFrameUrl(frame.url || convertFileSrc(frame.path));
      } else {
        if (!sourceUrl.trim()) throw new Error("Укажите Twitch или Kick VOD URL.");
        const timeSec = parseTime(start) ?? 0;
        const frame = await ipc.capturePreviewFrame({
          url: sourceUrl.trim(),
          timeSec,
          outputWidth: placement.outputWidth,
          outputHeight: placement.outputHeight,
          quality: null,
          proxy: settings.proxy,
          binariesDir: settings.binariesDir,
        });
        setFrameUrl(frame.url || convertFileSrc(frame.path));
      }
    } catch (err) {
      setFrameError(String(err));
    } finally {
      setFrameLoading(false);
    }
  };

  const downloadJson = async () => {
    if (platform === "kick") {
      await downloadKickJson(false);
      return;
    }
    await addExportToQueue("json");
  };

  const renderOnly = async () => {
    if (platform === "kick") {
      await downloadKickJson(true);
      return;
    }
    await addExportToQueue("render");
  };

  const addExportToQueue = async (_mode: "json" | "render" = "render") => {
    if (!sourceUrl.trim() || !fileName.trim() || !directory.trim()) return;
    setBusy("queue");
    setError(null);
    setKickWarning(null);
    try {
      const queueTarget = platform === "kick"
        ? await resolveKickQueueTarget(sourceUrl.trim(), fileName.trim(), directory.trim())
        : {
          url: sourceUrl.trim(),
          meta: { platform: detectPlatform(sourceUrl) },
        };

      await StreamDownloader.enqueueChatOnly(
        {
          url: queueTarget.url,
          name: fileName.trim(),
          directory: directory.trim(),
          job_kind: "chat",
          mode: "vod",
          download_kind: "video",
          start: start.trim() || null,
          end: end.trim() || null,
          fragments: [],
          split: false,
          split_interval_minutes: null,
          quality: null,
          quality_has_audio: null,
          quality_has_video: null,
          proxy: settings.proxy,
          chat_overlay: chatOverlay,
          performance: settings.performance,
          blur_zones: [],
          binaries_dir: settings.binariesDir,
          meta: queueTarget.meta,
        },
        chatOverlay,
      );
      setError("Экспорт чата добавлен в очередь.");
    } catch (err) {
      const message = String(err);
      if (platform === "kick" && message.includes(KICK_CHAT_REPLAY_UNAVAILABLE)) {
        setKickWarning(KICK_CHAT_REPLAY_UNAVAILABLE);
        setError(KICK_CHAT_REPLAY_UNAVAILABLE);
      } else {
        setError(`Не удалось добавить экспорт в очередь: ${message}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const resolveKickQueueTarget = async (source: string, name: string, outputDirectory: string) => {
    const input = {
      source,
      existingTask: {
        url: source,
        name,
        directory: outputDirectory,
        meta: { platform: "kick", title: name },
      },
    };
    const metadata = await resolveKickMetadata(input);
    const replay = await discoverKickChatReplaySource(input, metadata);

    return {
      url: `https://kick.com/${replay.slug}/videos/${replay.videoId}`,
      meta: {
        platform: "kick",
        title: name,
        uploader: replay.slug,
        duration: replay.durationMs ? replay.durationMs / 1000 : null,
      },
    };
  };

  const downloadKickJson = async (renderAfterDownload: boolean) => {
    if (!sourceUrl.trim() || !fileName.trim() || !directory.trim()) return;
    setBusy(renderAfterDownload ? "render" : "json");
    setError(null);
    setKickWarning(null);
    try {
      const startOffsetSec = parseTime(start);
      const endOffsetSec = parseTime(end);
      const exported = await exportKickChatJson({
        input: {
          source: sourceUrl.trim(),
          existingTask: {
            url: sourceUrl.trim(),
            name: fileName.trim(),
            directory: directory.trim(),
            meta: { platform: "kick", title: fileName.trim() },
          },
        },
        outputDirectory: directory.trim(),
        baseFileName: fileName.trim(),
        startOffsetMs: startOffsetSec == null ? null : startOffsetSec * 1000,
        endOffsetMs: endOffsetSec == null ? null : endOffsetSec * 1000,
      });
      setKickMessages(exported.messages);

      if (renderAfterDownload) {
        const rendered = await renderKickNormalizedChatJson(exported.messages, {
          outputDirectory: directory.trim(),
          outputName: fileName.trim(),
          chatOverlay,
          performance: settings.performance,
          binariesDir: settings.binariesDir,
        });
        setError(`JSON чата Kick сохранён. Рендер: ${rendered.outputPath}`);
      } else {
        setError(`JSON чата Kick сохранён: ${exported.normalizedPath}`);
      }
    } catch (err) {
      const message = String(err);
      if (message.includes(KICK_CHAT_REPLAY_UNAVAILABLE)) {
        setKickWarning(KICK_CHAT_REPLAY_UNAVAILABLE);
        setError(KICK_CHAT_REPLAY_UNAVAILABLE);
      } else {
        setError(`Не удалось скачать JSON чата Kick: ${message}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const setCodec = (next: ChatRenderCodec) => {
    setCodecState(next);
    settings.setChatOverlay({ ...chatOverlay, render_codec: next });
  };

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Рендер чата</h1>
          <div className={styles.subtitle}>Экспорт Twitch и Kick чата в JSON или отдельный файл с прозрачным фоном.</div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.column}>
          <ChatPositionPanel
            placement={placement}
            preserveRatio={preserveRatio}
            frameUrl={frameUrl}
            onPlacementChange={updatePlacement}
            onPreserveRatioChange={setPreserveRatio}
          />
          <ChatExportSettings
            codec={codec}
            overlayMode={overlayMode}
            composeMode={composeMode}
            alphaOutputFormat={alphaOutputFormat}
            solidBackgroundColor={solidBackgroundColor}
            alphaBackground={alphaBackground}
            fontFamily={fontFamily}
            fontStyle={fontStyle}
            fontSize={fontSize}
            fontWeight={fontWeight}
            usernameFontWeight={usernameFontWeight}
            backgroundEnabled={backgroundEnabled}
            backgroundOpacity={backgroundOpacity}
            showBadges={showBadges}
            showTimestamps={showTimestamps}
            showAvatars={showAvatars}
            showBttv={showBttv}
            showFfz={showFfz}
            show7tv={show7tv}
            saveCleanVideo={saveCleanVideo}
            cacheRemoteEmotes={cacheRemoteEmotes}
            systemFonts={systemFonts}
            onCodecChange={setCodec}
            onOverlayModeChange={setOverlayMode}
            onComposeModeChange={setComposeMode}
            onAlphaOutputFormatChange={(value) => {
              setAlphaOutputFormat(value);
              setOutputFormat(outputFormatForAlpha(value));
            }}
            onSolidBackgroundColorChange={setSolidBackgroundColor}
            onAlphaBackgroundChange={setAlphaBackground}
            onFontFamilyChange={setFontFamily}
            onFontStyleChange={setFontStyle}
            onFontSizeChange={(value) => setFontSize(clampDimension(value, 10, 72))}
            onFontWeightChange={(value) => setFontWeight(clampDimension(Math.round(value / 100) * 100, 100, 900))}
            onUsernameFontWeightChange={(value) => setUsernameFontWeight(clampDimension(Math.round(value / 100) * 100, 100, 900))}
            onBackgroundEnabledChange={setBackgroundEnabled}
            onBackgroundOpacityChange={(value) => setBackgroundOpacity(Math.max(0, Math.min(1, value)))}
            onShowBadgesChange={setShowBadges}
            onShowTimestampsChange={setShowTimestamps}
            onShowAvatarsChange={setShowAvatars}
            onShowBttvChange={setShowBttv}
            onShowFfzChange={setShowFfz}
            onShow7tvChange={setShow7tv}
            onSaveCleanVideoChange={setSaveCleanVideo}
            onCacheRemoteEmotesChange={(value) => {
              setCacheRemoteEmotes(value);
              settings.setIntegrations({ ...settings.integrations, cacheRemoteEmotes: value });
            }}
          />
        </div>

        <div className={styles.column}>
          <ChatFrameSourceCard
            mode={frameMode}
            screenshotUrl={screenshotUrl}
            loading={frameLoading}
            error={frameError}
            onModeChange={setFrameMode}
            onScreenshotUrlChange={setScreenshotUrl}
            onPaste={() => void pasteScreenshot()}
            onUpdatePreview={() => void updatePreview()}
          />
          <ChatResultPreview
            platform={platform}
            format={outputFormat}
            alphaBackground={alphaBackground}
            fontFamily={fontFamily}
            fontStyle={fontStyle}
            fontSize={fontSize}
            fontWeight={fontWeight}
            usernameFontWeight={usernameFontWeight}
            textColor={textColor}
            outlineEnabled={outlineEnabled}
            outlineColor={outlineColor}
            outlineThickness={outlineThickness}
            backgroundEnabled={backgroundEnabled}
            backgroundOpacity={backgroundOpacity}
            showBadges={showBadges}
            showBttv={showBttv}
            showFfz={showFfz}
            show7tv={show7tv}
            cacheRemoteEmotes={cacheRemoteEmotes}
            messagesCount={kickMessages?.length ?? null}
            renderReady={platform === "twitch" || Boolean(kickMessages?.length)}
          />
        </div>
      </main>

      <aside className={styles.aside}>
        <ChatOnlyExportPanel
          presetName={activeChatPreset?.name ?? "Twitch Chat Default"}
          activePresetId={activeChatPresetId}
          presetOptions={chatPresets.map((preset) => ({ id: preset.id, name: preset.name }))}
          platform={platform}
          sourceUrl={sourceUrl}
          start={start}
          end={end}
          fileName={fileName}
          directory={directory}
          busy={busy}
          error={error}
          kickStatus={{
            downloaded: Boolean(kickMessages),
            messageCount: kickMessages?.length ?? null,
            renderReady: Boolean(kickMessages?.length),
            warning: kickWarning,
          }}
          onPresetChange={setActiveChatPreset}
          onSavePreset={() => {
            if (!activeChatPreset) return;
            saveChatPreset(activeChatPreset.id, chatOverlay);
            settings.setChatOverlay(chatOverlay);
          }}
          onDuplicatePreset={() => createChatPreset(activeChatPreset?.id ?? null)}
          onRenamePreset={() => {
            if (!activeChatPreset) return;
            const name = window.prompt("Новое имя пресета чата", activeChatPreset.name)?.trim();
            if (name) renameChatPreset(activeChatPreset.id, name);
          }}
          onPlatformChange={setPlatform}
          onSourceUrlChange={setSourceUrl}
          onStartChange={setStart}
          onEndChange={setEnd}
          onFileNameChange={setFileName}
          onDirectoryChange={setDirectory}
          onChooseDirectory={() => void chooseDirectory()}
          onDownloadJson={() => void downloadJson()}
          onRenderOnly={() => void renderOnly()}
          onAddToQueue={() => void addExportToQueue("render")}
        />
      </aside>
    </div>
  );
}

function outputFormatForAlpha(format: AlphaOutputFormat): ChatOutputFormat {
  if (format === "webm_vp9" || format === "webm_vp8") return "webm";
  return "mov";
}

function parseTime(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function normalizePlacement<T extends { x: number; y: number; width: number; height: number; outputWidth: number; outputHeight: number }>(
  placement: T,
): T {
  const outputWidth = clampDimension(placement.outputWidth, 320, 7680);
  const outputHeight = clampDimension(placement.outputHeight, 180, 4320);
  const width = clampDimension(placement.width, 120, outputWidth);
  const height = clampDimension(placement.height, 80, outputHeight);
  return {
    ...placement,
    outputWidth,
    outputHeight,
    width,
    height,
    x: clampDimension(placement.x, 0, outputWidth - width),
    y: clampDimension(placement.y, 0, outputHeight - height),
  };
}

function clampDimension(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, normalized));
}
