import type { Job } from "@/types/job";

export const KICK_CHAT_REPLAY_UNAVAILABLE =
  "Kick chat replay endpoint unavailable or changed.";

export type KickInputKind = "channel" | "video" | "slug" | "kickvod" | "unknown";

export interface KickParsedInput {
  kind: KickInputKind;
  original: string;
  slug: string | null;
  videoId: string | null;
}

export interface KickExistingTaskInput {
  url: string;
  name?: string | null;
  directory?: string | null;
  meta?: {
    title?: string | null;
    uploader?: string | null;
    platform?: string | null;
    thumbnail?: string | null;
    duration?: number | null;
  } | null;
}

export interface KickChatExportInput {
  source?: string | null;
  slug?: string | null;
  videoId?: string | null;
  existingTask?: KickExistingTaskInput | Job | null;
}

export interface KickServiceOptions {
  accessToken?: string | null;
  signal?: AbortSignal | null;
  retries?: number;
  minDelayMs?: number;
  requestTimeoutMs?: number;
  fetchText?: (url: string, init?: KickFetchInit) => Promise<string>;
  fetchJson?: <T = unknown>(url: string, init?: KickFetchInit) => Promise<T>;
}

export interface KickFetchInit {
  method?: "GET";
  headers?: Record<string, string>;
  referer?: string | null;
  signal?: AbortSignal | null;
}

export interface KickChannelMetadata {
  id: string | null;
  broadcasterUserId: string | null;
  slug: string;
  displayName: string | null;
  title: string | null;
  profilePictureUrl: string | null;
  thumbnailUrl: string | null;
  isLive: boolean | null;
  startedAt: string | null;
  raw: unknown;
}

export interface KickVideoMetadata {
  id: string;
  slug: string | null;
  title: string | null;
  createdAt: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  raw: unknown;
}

export interface KickResolvedMetadata {
  parsed: KickParsedInput;
  channel: KickChannelMetadata | null;
  video: KickVideoMetadata | null;
  warnings: string[];
}

export interface KickChatReplaySource {
  adapter: "kickvod";
  slug: string;
  videoId: string;
  replaySlug: string;
  videoCreatedAtMs: number;
  durationMs: number | null;
  pageUrl: string;
  raw: unknown;
}

export interface KickChatPage {
  url: string;
  startMs: number;
  endMs: number;
  messages: KickRawChatMessage[];
}

export interface KickRawChatDownload {
  source: KickChatReplaySource;
  pages: KickChatPage[];
  messages: KickRawChatMessage[];
  downloadedAt: string;
}

export interface KickRawChatMessage {
  id?: string | number | null;
  type?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  timestamp?: string | number | null;
  user?: unknown;
  sender?: unknown;
  username?: string | null;
  slug?: string | null;
  userId?: string | number | null;
  user_id?: string | number | null;
  color?: string | null;
  badges?: unknown;
  content?: unknown;
  message?: unknown;
  metadata?: unknown;
  reply_to?: unknown;
  replyTo?: unknown;
  [key: string]: unknown;
}

export interface KickNormalizedChatMessage {
  id: string;
  platform: "kick";
  offsetMs: number;
  createdAt: string;
  authorId: string | null;
  authorName: string;
  authorColor: string | null;
  authorBadges: KickAuthorBadge[];
  text: string;
  fragments: KickChatFragment[];
  emotes: KickChatEmote[];
  replyTo: KickChatReply | null;
  raw: KickRawChatMessage;
}

export interface KickAuthorBadge {
  id: string;
  label: string | null;
  count: number | null;
  raw: unknown;
}

export type KickChatFragment =
  | { type: "text"; text: string }
  | { type: "emote"; id: string; text: string; url: string | null };

export interface KickChatEmote {
  id: string;
  text: string;
  url: string | null;
}

export interface KickChatReply {
  id: string | null;
  authorName: string | null;
  text: string | null;
  raw: unknown;
}

export interface KickChatExportSummary {
  messageCount: number;
  startTime: string | null;
  endTime: string | null;
  warnings: string[];
}

export interface KickChatExportResult {
  rawPath: string;
  normalizedPath: string;
  rawFileName: string;
  normalizedFileName: string;
  raw: KickRawChatDownload;
  messages: KickNormalizedChatMessage[];
  summary: KickChatExportSummary;
}

export interface KickChatExportOptions extends KickServiceOptions {
  input: KickChatExportInput;
  outputDirectory: string;
  baseFileName: string;
  startOffsetMs?: number | null;
  endOffsetMs?: number | null;
  writer?: KickJsonWriter;
}

export type KickJsonWriter = (path: string, contents: string) => Promise<void>;
