import { KickClient, createKickClient } from "./kickClient";
import { getKickInputTaskMeta, normalizeKickSlug } from "./kickUrlParser";
import {
  KICK_CHAT_REPLAY_UNAVAILABLE,
  type KickChatExportInput,
  type KickChatReplaySource,
  type KickResolvedMetadata,
  type KickServiceOptions,
} from "./kickTypes";

export async function discoverKickChatReplaySource(
  input: KickChatExportInput,
  metadata: KickResolvedMetadata,
  options: KickServiceOptions = {},
): Promise<KickChatReplaySource> {
  const client = createKickClient(options);
  let videoId = metadata.parsed.videoId ?? input.videoId?.trim() ?? null;
  let slug =
    metadata.parsed.slug ??
    metadata.channel?.slug ??
    metadata.video?.slug ??
    normalizeKickSlug(getKickInputTaskMeta(input)?.uploader);

  if (!slug && videoId) {
    slug = await findKickVodSlugForVideo(videoId, client);
  }

  if (!videoId && slug) {
    videoId = await findLatestKickVodVideoId(slug, client);
  }

  if (!videoId) {
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }
  if (!slug) {
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }

  return discoverKickVodReplaySource(slug, videoId, client);
}

export async function discoverKickVodReplaySource(
  slug: string,
  videoId: string,
  clientOrOptions: KickClient | KickServiceOptions = {},
): Promise<KickChatReplaySource> {
  const client = clientOrOptions instanceof KickClient ? clientOrOptions : createKickClient(clientOrOptions);
  const pageUrl = `https://kickvod.com/${encodeURIComponent(slug)}/${encodeURIComponent(videoId)}`;

  let html: string;
  try {
    html = await client.getText(pageUrl, { referer: "https://kickvod.com/" });
  } catch {
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }

  const archivedVideoId = extractJsStringConst(html, "vodId");
  const replaySlug = extractJsStringConst(html, "slug") ?? slug;
  const videoCreatedAtMs = extractJsNumberConst(html, "vodCreatedAt");
  const durationMs = extractJsNumberConst(html, "vodDuration");

  if (!archivedVideoId || archivedVideoId.toLowerCase() !== videoId.toLowerCase() || !videoCreatedAtMs) {
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }

  return {
    adapter: "kickvod",
    slug,
    videoId,
    replaySlug,
    videoCreatedAtMs,
    durationMs,
    pageUrl,
    raw: {
      pageUrl,
      vodId: archivedVideoId,
      slug: replaySlug,
      vodCreatedAt: videoCreatedAtMs,
      vodDuration: durationMs,
    },
  };
}

function extractJsStringConst(html: string, name: string): string | null {
  const pattern = new RegExp(`const\\s+${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`);
  return html.match(pattern)?.[1] ?? null;
}

function extractJsNumberConst(html: string, name: string): number | null {
  const pattern = new RegExp(`const\\s+${escapeRegExp(name)}\\s*=\\s*(\\d+)`);
  const value = Number(html.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findLatestKickVodVideoId(slug: string, client: KickClient): Promise<string | null> {
  try {
    const html = await client.getText(`https://kickvod.com/${encodeURIComponent(slug)}`, {
      referer: "https://kickvod.com/",
    });
    return extractKickVodVideoIds(html, slug)[0] ?? null;
  } catch {
    return null;
  }
}

async function findKickVodSlugForVideo(videoId: string, client: KickClient): Promise<string | null> {
  let home: string;
  try {
    home = await client.getText("https://kickvod.com/", { referer: "https://kickvod.com/" });
  } catch {
    return null;
  }

  for (const slug of extractKickVodChannelSlugs(home)) {
    try {
      const html = await client.getText(`https://kickvod.com/${encodeURIComponent(slug)}`, {
        referer: "https://kickvod.com/",
      });
      if (html.includes(videoId)) return slug;
    } catch {
      // Skip unavailable channel pages and keep scanning the public KickVOD index.
    }
  }

  return null;
}

function extractKickVodVideoIds(html: string, slug: string): string[] {
  const ids: string[] = [];
  const safeSlug = escapeRegExp(slug);
  const pattern = new RegExp(`(?:href=["']|["']href["']\\s*:\\s*["']|["'])/${safeSlug}/([0-9a-f-]{36})(?=["'/?\\\\])`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const id = match[1]?.toLowerCase();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function extractKickVodChannelSlugs(html: string): string[] {
  const slugs: string[] = [];
  const pattern = /(?:href=["']|["']href["']\s*:\s*["'])\/([a-z0-9][a-z0-9_-]{1,24})(?=["'/?\\])/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const slug = normalizeKickSlug(match[1]);
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}
