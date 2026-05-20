import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import "@/lib/video-js/video-js.min.css";
import videoJsScriptUrl from "@/lib/video-js/video.min.js?url";

declare global {
  interface Window {
    videojs?: VideoJsFactory;
  }
}

type VideoJsPlayer = {
  dispose: () => void;
  src: (source: { src: string; type: string }) => void;
  ready: (cb: () => void) => void;
  on: (event: string, cb: () => void) => void;
  off: (event: string, cb: () => void) => void;
  currentTime: (value?: number) => number;
  duration: () => number;
  paused: () => boolean;
  play: () => Promise<void> | void;
  pause: () => void;
  muted: (value?: boolean) => boolean;
  volume: (value?: number) => number;
  error: () => { code?: number; message?: string } | null;
};

type VideoJsFactory = (
  element: HTMLVideoElement,
  options: Record<string, unknown>,
) => VideoJsPlayer;

let videoJsPromise: Promise<VideoJsFactory> | null = null;

function loadVideoJs(): Promise<VideoJsFactory> {
  if (window.videojs) {
    return Promise.resolve(window.videojs);
  }
  if (videoJsPromise) {
    return videoJsPromise;
  }

  videoJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = videoJsScriptUrl;
    script.async = true;
    script.onload = () => {
      if (window.videojs) {
        resolve(window.videojs);
      } else {
        reject(new Error("Video.js loaded without global videojs"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load local Video.js"));
    document.head.appendChild(script);
  });

  return videoJsPromise;
}

export interface HlsPlayerHandle {
  getCurrentTime: () => number;
  seek: (seconds: number) => void;
  captureFrame: () => string | null;
}

interface HlsPlayerProps {
  src: string | null;
  className?: string;
  audioInfo?: {
    hasAudio: boolean;
    qualityLabel?: string | null;
  } | null;
}

function isHlsUrl(src: string): boolean {
  return src.toLowerCase().split("?")[0]?.includes(".m3u8") ?? false;
}

function isLocalPreviewUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.pathname.startsWith("/hls") || url.pathname.startsWith("/preview/"))
    );
  } catch {
    return false;
  }
}

function twitchReferer(src: string): string | null {
  return src.includes("twitch.tv") || src.includes("ttvnw.net") || src.includes("cloudfront.net")
    ? "https://www.twitch.tv/"
    : null;
}

export const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  ({ src, className, audioInfo }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playerRef = useRef<VideoJsPlayer | null>(null);
    const [playerSrc, setPlayerSrc] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(0.85);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => playerRef.current?.currentTime() ?? videoRef.current?.currentTime ?? 0,
      seek: (seconds) => {
        if (playerRef.current) {
          playerRef.current.currentTime(seconds);
        } else if (videoRef.current) {
          videoRef.current.currentTime = seconds;
        }
      },
      captureFrame: () => {
        const video = videoRef.current;
        if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
          return null;
        }
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      },
    }));

    useEffect(() => {
      let cancelled = false;
      setError(null);
      setReady(false);
      setPlayerSrc(null);

      if (!src) {
        return;
      }

      if (!isHlsUrl(src) || isLocalPreviewUrl(src)) {
        setPlayerSrc(src);
        return;
      }

      void ipc
        .proxiedHlsUrl(src, twitchReferer(src))
        .then((proxied) => {
          if (!cancelled) {
            setPlayerSrc(proxied);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(`HLS proxy: ${String(err)}`);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [src]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !playerSrc) {
        return;
      }

      let disposed = false;
      setError(null);
      setReady(false);

      void loadVideoJs()
        .then((videojs) => {
          if (disposed) {
            return;
          }
          playerRef.current?.dispose();
          const player = videojs(video, {
            controls: false,
            autoplay: false,
            muted: false,
            preload: "auto",
            fluid: true,
            html5: {
              vhs: {
                overrideNative: true,
                withCredentials: false,
              },
              nativeAudioTracks: false,
              nativeVideoTracks: false,
            },
          });
          playerRef.current = player;
          player.muted(muted);
          player.volume(volume);

          const sourceType = (src && isHlsUrl(src)) || isHlsUrl(playerSrc)
            ? "application/x-mpegURL"
            : "video/mp4";
          player.src({ src: playerSrc, type: sourceType });

          const onTime = () => setCurrent(player.currentTime() || 0);
          const onDuration = () => setDuration(player.duration() || 0);
          const onPlay = () => setPlaying(true);
          const onPause = () => setPlaying(false);
          const onError = () => {
            const err = player.error();
            setError(`Video.js: ${err?.message ?? err?.code ?? "unknown error"}`);
          };

          player.ready(() => {
            setReady(true);
          });
          player.on("timeupdate", onTime);
          player.on("durationchange", onDuration);
          player.on("loadedmetadata", onDuration);
          player.on("play", onPlay);
          player.on("pause", onPause);
          player.on("error", onError);
        })
        .catch((err) => setError(String(err)));

      return () => {
        disposed = true;
        playerRef.current?.dispose();
        playerRef.current = null;
      };
    }, [playerSrc]);

    useEffect(() => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      player.muted(muted);
      player.volume(volume);
    }, [muted, volume]);

    const toggle = () => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      if (player.paused()) {
        void Promise.resolve(player.play()).catch((err) =>
          setError(`play(): ${err?.message ?? err}`),
        );
      } else {
        player.pause();
      }
    };

    const skip = (delta: number) => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      player.currentTime(Math.max(0, (player.currentTime() || 0) + delta));
    };

    const toggleMuted = () => {
      setMuted((value) => !value);
    };

    const changeVolume = (value: number) => {
      const next = Math.max(0, Math.min(1, value));
      setVolume(next);
      setMuted(next === 0);
    };

    const copyUrl = async () => {
      if (!playerSrc) {
        return;
      }
      try {
        await navigator.clipboard.writeText(playerSrc);
      } catch {
        /* noop */
      }
    };

    const audioLabel = audioInfo?.qualityLabel
      ? `Audio ${audioInfo.qualityLabel}`
      : audioInfo?.hasAudio
        ? "Audio detected"
        : "Audio status";

    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded border border-border-default bg-black",
          className,
        )}
      >
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            className="video-js h-full w-full"
            playsInline
            crossOrigin="anonymous"
          />
          {!src && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-tertiary">
              No source
            </div>
          )}
          {src && !ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-[12px] text-fg-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stream...
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-[12px] text-danger">
              <AlertTriangle className="h-5 w-5" />
              <div className="max-w-[90%] break-words">{error}</div>
              {playerSrc && (
                <Button size="md" variant="secondary" onClick={copyUrl}>
                  <Copy className="h-3.5 w-3.5" />
                  Copy URL
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-border-default bg-surface px-2 pt-1.5">
          <div className="mb-1 flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-success" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-success/15" title={audioLabel}>
              <div className="h-full w-full bg-success" />
            </div>
            <span className="w-24 truncate text-right font-mono text-[10.5px] text-fg-tertiary">
              {audioLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surface px-2 pb-1.5">
          <Button size="icon-sm" variant="ghost" onClick={() => skip(-5)} aria-label="-5s">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon-sm" variant="secondary" onClick={toggle} aria-label="Play/Pause">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => skip(5)} aria-label="+5s">
            <RotateCcw className="h-3.5 w-3.5 scale-x-[-1]" />
          </Button>
          <span className="ml-2 font-mono text-[11px] text-fg-secondary tabular">
            {formatDuration(current)} / {formatDuration(duration)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={current}
            onChange={(event) => playerRef.current?.currentTime(Number(event.target.value))}
            className="ml-2 h-1 flex-1 accent-accent"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggleMuted}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            className="h-1 w-20 accent-accent"
            aria-label="Volume"
            title="Volume"
          />
          <Button size="icon-sm" variant="ghost" onClick={copyUrl} aria-label="Copy URL" title="Copy URL">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  },
);
HlsPlayer.displayName = "HlsPlayer";
