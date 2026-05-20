import type { KickChatExportInput, KickParsedInput } from "./kickTypes";

export interface KickInputTaskMeta {
  title?: string | null;
  uploader?: string | null;
  platform?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
}

const RESERVED_SLUGS = new Set([
  "about",
  "api",
  "categories",
  "category",
  "clips",
  "community-guidelines",
  "dashboard",
  "explore",
  "following",
  "search",
  "terms-of-service",
  "video",
  "videos",
]);

export function parseKickInput(input: KickChatExportInput | string): KickParsedInput {
  const source =
    typeof input === "string"
      ? input
      : input.source || getKickInputTaskUrl(input) || input.slug || input.videoId || "";
  const explicitSlug = typeof input === "string" ? null : normalizeKickSlug(input.slug);
  const explicitVideoId = typeof input === "string" ? null : normalizeKickVideoId(input.videoId);
  const parsed = parseKickSource(source);

  return {
    ...parsed,
    slug: explicitSlug ?? parsed.slug,
    videoId: explicitVideoId ?? parsed.videoId,
  };
}

export function parseKickSource(source: string): KickParsedInput {
  const original = source.trim();
  if (!original) {
    return { kind: "unknown", original, slug: null, videoId: null };
  }

  const bareSlug = normalizeKickSlug(original);
  if (bareSlug && !original.includes("/") && !isUuidLike(original)) {
    return { kind: "slug", original, slug: bareSlug, videoId: null };
  }

  const url = toUrl(original);
  if (!url) {
    return {
      kind: isUuidLike(original) ? "video" : "unknown",
      original,
      slug: null,
      videoId: normalizeKickVideoId(original),
    };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const videoId = parts.map(normalizeKickVideoId).find(Boolean) ?? null;

  if (host === "kickvod.com") {
    return {
      kind: "kickvod",
      original,
      slug: normalizeKickSlug(parts[0]),
      videoId,
    };
  }

  if (host.endsWith("kick.com")) {
    const videoMarkerIndex = parts.findIndex((part) => part.toLowerCase() === "video" || part.toLowerCase() === "videos");
    const slug = videoMarkerIndex > 0 ? normalizeKickSlug(parts[0]) : normalizeKickSlug(parts[0]);

    return {
      kind: videoId ? "video" : "channel",
      original,
      slug,
      videoId,
    };
  }

  return { kind: "unknown", original, slug: null, videoId };
}

export function normalizeKickSlug(value?: string | null): string | null {
  const slug = value
    ?.trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(?:www\.)?kick\.com\//i, "")
    .split(/[/?#]/)[0]
    ?.toLowerCase();

  if (!slug || isUuidLike(slug) || RESERVED_SLUGS.has(slug)) return null;
  if (!/^[a-z0-9][a-z0-9_-]{1,24}$/i.test(slug)) return null;
  return slug;
}

export function normalizeKickVideoId(value?: string | null): string | null {
  if (!value) return null;
  const candidate = value
    .trim()
    .split(/[/?#]/)
    .find((part) => isUuidLike(part));
  return candidate?.toLowerCase() ?? null;
}

export function isKickUrl(value: string): boolean {
  const url = toUrl(value);
  return Boolean(url && url.hostname.toLowerCase().replace(/^www\./, "").endsWith("kick.com"));
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function getKickInputTaskUrl(input: KickChatExportInput): string | null {
  const task = input.existingTask;
  if (!task) return null;
  if ("spec" in task) return task.spec.url;
  return task.url;
}

export function getKickInputTaskName(input: KickChatExportInput): string | null {
  const task = input.existingTask;
  if (!task) return null;
  if ("spec" in task) return task.spec.name;
  return task.name ?? null;
}

export function getKickInputTaskDirectory(input: KickChatExportInput): string | null {
  const task = input.existingTask;
  if (!task) return null;
  if ("spec" in task) return task.spec.directory;
  return task.directory ?? null;
}

export function getKickInputTaskMeta(input: KickChatExportInput): KickInputTaskMeta | null {
  const task = input.existingTask;
  if (!task) return null;
  if ("spec" in task) return task.spec.meta ?? null;
  return task.meta ?? null;
}

function toUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}
