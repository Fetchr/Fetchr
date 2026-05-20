import { KickClient, createKickClient } from "./kickClient";
import {
  KICK_CHAT_REPLAY_UNAVAILABLE,
  type KickChatPage,
  type KickChatReplaySource,
  type KickRawChatDownload,
  type KickRawChatMessage,
  type KickServiceOptions,
} from "./kickTypes";

const KICKVOD_CHUNK_MS = 10_000;

export interface DownloadKickChatOptions extends KickServiceOptions {
  startOffsetMs?: number | null;
  endOffsetMs?: number | null;
}

export async function downloadKickChatReplay(
  source: KickChatReplaySource,
  options: DownloadKickChatOptions = {},
): Promise<KickRawChatDownload> {
  const client = createKickClient(options);
  const durationMs = source.durationMs;
  if (!durationMs || durationMs <= 0) {
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }

  const startOffset = clampMs(options.startOffsetMs ?? 0, 0, durationMs);
  const endOffset = clampMs(options.endOffsetMs ?? durationMs, startOffset, durationMs);
  if (endOffset <= startOffset) {
    throw new Error("Kick chat export range is empty.");
  }

  const pages: KickChatPage[] = [];
  const messages: KickRawChatMessage[] = [];
  const seen = new Set<string>();
  let cursor = source.videoCreatedAtMs + startOffset;
  const end = source.videoCreatedAtMs + endOffset;

  while (cursor < end) {
    const chunkEnd = Math.min(cursor + KICKVOD_CHUNK_MS, end);
    const url = `https://kickvod.com/api/messages/${encodeURIComponent(source.replaySlug)}?start=${cursor}&end=${chunkEnd}`;
    const pageMessages = await fetchKickChatPage(url, client);
    pages.push({
      url,
      startMs: cursor,
      endMs: chunkEnd,
      messages: pageMessages,
    });

    for (const message of pageMessages) {
      const id = rawMessageKey(message);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      messages.push(message);
    }

    cursor = chunkEnd;
  }

  return {
    source,
    pages,
    messages,
    downloadedAt: new Date().toISOString(),
  };
}

async function fetchKickChatPage(url: string, client: KickClient): Promise<KickRawChatMessage[]> {
  try {
    const value = await client.getJson<unknown>(url, { referer: "https://kickvod.com/" });
    const messages = extractRawMessages(value);
    if (!messages) throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
    return messages.filter(isRawMessage) as KickRawChatMessage[];
  } catch (error) {
    if (String(error).includes(KICK_CHAT_REPLAY_UNAVAILABLE)) throw error;
    throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
  }
}

function extractRawMessages(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;

  const record = asRecord(value);
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.chat)) return record.chat;

  const data = asRecord(record.data);
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.chat)) return data.chat;

  return null;
}

function isRawMessage(value: unknown): value is KickRawChatMessage {
  return Boolean(value && typeof value === "object");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rawMessageKey(message: KickRawChatMessage): string | null {
  const id = message.id ?? `${message.createdAt ?? message.created_at ?? ""}:${message.username ?? message.slug ?? ""}:${message.content ?? ""}`;
  return id == null ? null : String(id);
}

function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
