import { KickClient, createKickClient } from "./kickClient";
import { getKickInputTaskMeta, getKickInputTaskUrl, normalizeKickSlug, parseKickInput } from "./kickUrlParser";
import type {
  KickChannelMetadata,
  KickChatExportInput,
  KickResolvedMetadata,
  KickServiceOptions,
  KickVideoMetadata,
} from "./kickTypes";

export async function resolveKickMetadata(
  input: KickChatExportInput,
  options: KickServiceOptions = {},
): Promise<KickResolvedMetadata> {
  const client = createKickClient(options);
  const parsed = parseKickInput(input);
  const warnings: string[] = [];
  let channel: KickChannelMetadata | null = null;
  let video: KickVideoMetadata | null = null;

  const taskMeta = getKickInputTaskMeta(input);
  const slug = parsed.slug ?? normalizeKickSlug(taskMeta?.uploader);
  if (slug) {
    channel = await fetchChannelMetadata(slug, client, warnings);
  }

  if (parsed.videoId) {
    video = await fetchVideoMetadata(parsed.videoId, parsed.slug ?? slug, input, client, warnings);
  }

  return {
    parsed: {
      ...parsed,
      slug: parsed.slug ?? channel?.slug ?? slug ?? null,
      videoId: parsed.videoId,
    },
    channel,
    video,
    warnings,
  };
}

export async function fetchChannelMetadata(
  slug: string,
  clientOrOptions: KickClient | KickServiceOptions = {},
  warnings: string[] = [],
): Promise<KickChannelMetadata | null> {
  const client = clientOrOptions instanceof KickClient ? clientOrOptions : createKickClient(clientOrOptions);

  if (client.hasAccessToken()) {
    try {
      const response = await client.getJson<{ data?: unknown[] }>(
        `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
        { headers: client.officialHeaders() },
      );
      const official = Array.isArray(response.data) ? response.data[0] : null;
      if (official) return mapOfficialChannel(official, slug);
    } catch (error) {
      warnings.push(`Official Kick channel API failed, using public page metadata fallback: ${String(error)}`);
    }
  } else {
    warnings.push("Official Kick channel API requires OAuth; using public page metadata fallback.");
  }

  try {
    const raw = await client.getJson<unknown>(`https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`, {
      referer: `https://kick.com/${slug}`,
    });
    return mapInternalChannel(raw, slug);
  } catch (error) {
    warnings.push(`Kick public channel metadata unavailable: ${String(error)}`);
    return null;
  }
}

export async function fetchVideoMetadata(
  videoId: string,
  slug: string | null,
  input: KickChatExportInput,
  clientOrOptions: KickClient | KickServiceOptions = {},
  warnings: string[] = [],
): Promise<KickVideoMetadata> {
  const client = clientOrOptions instanceof KickClient ? clientOrOptions : createKickClient(clientOrOptions);
  const taskMeta = getKickInputTaskMeta(input);
  const base: KickVideoMetadata = {
    id: videoId,
    slug,
    title: taskMeta?.title ?? null,
    createdAt: null,
    durationMs: typeof taskMeta?.duration === "number" ? Math.round(taskMeta.duration * 1000) : null,
    thumbnailUrl: taskMeta?.thumbnail ?? null,
    sourceUrl: input.source ?? getKickInputTaskUrl(input),
    raw: null,
  };

  for (const endpoint of [
    `https://kick.com/api/v1/video/${encodeURIComponent(videoId)}`,
    `https://kick.com/api/v2/video/${encodeURIComponent(videoId)}`,
  ]) {
    try {
      const raw = await client.getJson<unknown>(endpoint, {
        referer: slug ? `https://kick.com/${slug}/videos/${videoId}` : "https://kick.com/",
      });
      return {
        ...base,
        ...mapInternalVideo(raw, videoId, slug),
        raw,
      };
    } catch {
      // Try the next known public metadata shape.
    }
  }

  warnings.push("Kick VOD metadata endpoint unavailable; using URL/task metadata only.");
  return base;
}

function mapOfficialChannel(raw: unknown, fallbackSlug: string): KickChannelMetadata {
  const value = asRecord(raw);
  const stream = asRecord(value.stream);
  const category = asRecord(value.category);
  return {
    id: stringValue(value.channel_id ?? value.id),
    broadcasterUserId: stringValue(value.broadcaster_user_id),
    slug: stringValue(value.slug) ?? fallbackSlug,
    displayName: stringValue(value.slug) ?? fallbackSlug,
    title: stringValue(value.stream_title),
    profilePictureUrl: stringValue(value.profile_picture),
    thumbnailUrl: stringValue(stream.thumbnail ?? category.thumbnail ?? value.banner_picture),
    isLive: booleanValue(stream.is_live),
    startedAt: stringValue(stream.start_time),
    raw,
  };
}

function mapInternalChannel(raw: unknown, fallbackSlug: string): KickChannelMetadata {
  const value = asRecord(raw);
  const user = asRecord(value.user);
  const livestream = asRecord(value.livestream);
  return {
    id: stringValue(value.id),
    broadcasterUserId: stringValue(value.user_id ?? user.id),
    slug: stringValue(value.slug) ?? fallbackSlug,
    displayName: stringValue(user.username ?? value.slug) ?? fallbackSlug,
    title: stringValue(livestream.session_title ?? value.stream_title),
    profilePictureUrl: stringValue(user.profile_pic),
    thumbnailUrl: stringValue(livestream.thumbnail?.url ?? value.banner_image ?? value.offline_banner_image),
    isLive: booleanValue(livestream.is_live) ?? Boolean(value.livestream),
    startedAt: stringValue(livestream.created_at ?? livestream.start_time),
    raw,
  };
}

function mapInternalVideo(raw: unknown, videoId: string, fallbackSlug: string | null): Partial<KickVideoMetadata> {
  const value = asRecord(raw);
  const livestream = asRecord(value.livestream);
  const channel = asRecord(value.channel);
  const thumbnail = asRecord(value.thumbnail);
  return {
    id: stringValue(value.id) ?? videoId,
    slug: stringValue(channel.slug ?? value.slug) ?? fallbackSlug,
    title: stringValue(value.title ?? value.session_title ?? livestream.session_title),
    createdAt: stringValue(value.created_at ?? value.start_time ?? livestream.created_at),
    durationMs: numberToMs(value.duration ?? value.duration_seconds ?? value.duration_ms),
    thumbnailUrl: stringValue(thumbnail.url ?? value.thumbnail_url ?? value.thumbnail),
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberToMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 10_000 ? Math.round(value) : Math.round(value * 1000);
}
