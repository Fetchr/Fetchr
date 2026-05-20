import { useEffect, useMemo, useState, type CSSProperties, type ImgHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { platformLabel, type Platform } from "@/lib/url";

import styles from "./RemoteImage.module.css";

type RemoteImageState = "idle" | "loading" | "loaded" | "error";

export interface RemoteImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "children" | "src"> {
  src?: string | null;
  alt: string;
  fallbackLabel?: string | null;
  platform?: Platform | string | null;
  platformBadge?: string | null;
  aspectRatio?: string;
  fit?: "cover" | "contain";
}

export function RemoteImage({
  src,
  alt,
  fallbackLabel,
  platform,
  platformBadge,
  aspectRatio = "16 / 9",
  fit = "cover",
  className,
  style,
  loading = "lazy",
  referrerPolicy = "no-referrer",
  onError,
  onLoad,
  ...imageProps
}: RemoteImageProps) {
  const [state, setState] = useState<RemoteImageState>(src ? "loading" : "idle");

  useEffect(() => {
    setState(src ? "loading" : "idle");
  }, [src]);

  const badge = platformBadge ?? getPlatformBadge(platform);
  const label = fallbackLabel?.trim() || badge || "Fetchr";
  const mark = useMemo(() => getFallbackMark(label), [label]);
  const showImage = Boolean(src) && state !== "error";
  const showSpinner = Boolean(src) && state === "loading";
  const rootStyle = {
    ...style,
    "--remote-image-aspect-ratio": aspectRatio,
    "--remote-image-fit": fit,
  } as CSSProperties;

  return (
    <div
      className={cn(styles.root, state === "error" && styles.error, className)}
      data-state={state}
      style={rootStyle}
    >
      {showImage && (
        <img
          {...imageProps}
          alt={alt}
          className={cn(styles.image, state === "loaded" && styles.imageLoaded)}
          loading={loading}
          referrerPolicy={referrerPolicy}
          src={src ?? undefined}
          onError={(event) => {
            setState("error");
            onError?.(event);
          }}
          onLoad={(event) => {
            setState("loaded");
            onLoad?.(event);
          }}
        />
      )}

      {state !== "loaded" && (
        <div className={styles.placeholder} aria-hidden={showImage}>
          <div>
            <div className={styles.fallbackMark}>{mark}</div>
            <div className={styles.label}>{label}</div>
          </div>
        </div>
      )}

      {badge && <div className={styles.badge}>{badge}</div>}
      {showSpinner && <div className={styles.spinner} aria-hidden />}
    </div>
  );
}

function getPlatformBadge(platform?: Platform | string | null): string | null {
  if (!platform) return null;
  const key = platform.toLowerCase();
  if (isKnownPlatform(key)) return platformLabel(key);
  return platform;
}

function isKnownPlatform(platform: string): platform is Platform {
  return ["hls", "kick", "rtmp", "twitch", "unknown", "vk", "youtube"].includes(platform);
}

function getFallbackMark(label: string): string {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}
