import type {
  KickAuthorBadge,
  KickChatFragment,
  KickChatReply,
  KickNormalizedChatMessage,
  KickRawChatDownload,
  KickRawChatMessage,
} from "./kickTypes";

export function normalizeKickChat(raw: KickRawChatDownload): KickNormalizedChatMessage[] {
  const vodStartMs = raw.source.videoCreatedAtMs;
  return raw.messages
    .map((message, index) => normalizeKickChatMessage(message, vodStartMs, index))
    .filter((message): message is KickNormalizedChatMessage => Boolean(message))
    .sort((a, b) => a.offsetMs - b.offsetMs);
}

export function normalizeKickChatMessage(
  raw: KickRawChatMessage,
  vodStartMs: number,
  fallbackIndex = 0,
): KickNormalizedChatMessage | null {
  const createdAt = getCreatedAt(raw);
  if (!createdAt) return null;

  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return null;

  const content = getMessageText(raw);
  if (!content.trim()) return null;

  const fragments = parseKickFragments(content);
  const emotes = fragments
    .filter((fragment): fragment is Extract<KickChatFragment, { type: "emote" }> => fragment.type === "emote")
    .map((fragment) => ({
      id: fragment.id,
      text: fragment.text,
      url: fragment.url,
    }));

  return {
    id: getMessageId(raw, createdAt, fallbackIndex),
    platform: "kick",
    offsetMs: Math.max(0, createdAtMs - vodStartMs),
    createdAt,
    authorId: getAuthorId(raw),
    authorName: getAuthorName(raw),
    authorColor: getAuthorColor(raw),
    authorBadges: getAuthorBadges(raw),
    text: fragments.map((fragment) => fragment.type === "text" ? fragment.text : fragment.text).join(""),
    fragments,
    emotes,
    replyTo: parseReply(raw),
    raw,
  };
}

export function parseKickFragments(content: string): KickChatFragment[] {
  const fragments: KickChatFragment[] = [];
  const emotePattern = /\[emote:([^:\]]+):([^\]]+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = emotePattern.exec(content))) {
    if (match.index > cursor) {
      fragments.push({ type: "text", text: content.slice(cursor, match.index) });
    }
    const id = match[1];
    const text = match[2];
    fragments.push({
      type: "emote",
      id,
      text,
      url: `https://files.kick.com/emotes/${id}/fullsize`,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    fragments.push({ type: "text", text: content.slice(cursor) });
  }

  return fragments.length ? fragments : [{ type: "text", text: content }];
}

function getCreatedAt(raw: KickRawChatMessage): string | null {
  const value = raw.createdAt ?? raw.created_at ?? raw.timestamp;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function getMessageText(raw: KickRawChatMessage): string {
  const type = stringValue(raw.type) ?? "message";
  const content = raw.content ?? raw.message ?? "";

  if (type === "reply") {
    const reply = parseJsonMaybe(content);
    return textFromContent(asRecord(reply).content ?? reply);
  }

  if (type !== "message") {
    const eventText = getEventText(type, content);
    if (eventText) return eventText;
  }

  return textFromContent(content);
}

function getEventText(type: string, content: unknown): string | null {
  const value = asRecord(parseJsonMaybe(content));
  if (type === "sub") {
    const username = stringValue(value.username) ?? "Someone";
    const months = numberValue(value.months) ?? 1;
    return `${username} subscribed for ${months} month(s).`;
  }
  if (type === "gift") {
    const from = stringValue(value.from) ?? "Someone";
    const to = Array.isArray(value.to) ? value.to.length : 1;
    return `${from} gifted ${to} sub(s).`;
  }
  if (type === "host") {
    const username = stringValue(value.username) ?? "Someone";
    const viewers = numberValue(value.viewers) ?? 0;
    return `${username} hosted with ${viewers} viewer(s).`;
  }
  return null;
}

function getMessageId(raw: KickRawChatMessage, createdAt: string, fallbackIndex: number): string {
  return stringValue(raw.id) ?? `${createdAt}:${getAuthorName(raw)}:${fallbackIndex}`;
}

function getAuthorId(raw: KickRawChatMessage): string | null {
  const user = asRecord(raw.user ?? raw.sender);
  return stringValue(raw.userId ?? raw.user_id ?? user.id ?? user.user_id);
}

function getAuthorName(raw: KickRawChatMessage): string {
  const user = asRecord(raw.user ?? raw.sender);
  return stringValue(raw.username ?? user.username ?? user.name ?? user.slug ?? raw.slug) ?? "kick";
}

function getAuthorColor(raw: KickRawChatMessage): string | null {
  const user = asRecord(raw.user ?? raw.sender);
  const identity = asRecord(user.identity);
  return stringValue(raw.color ?? user.color ?? identity.color);
}

function getAuthorBadges(raw: KickRawChatMessage): KickAuthorBadge[] {
  const user = asRecord(raw.user ?? raw.sender);
  const identity = asRecord(user.identity);
  return parseBadges(raw.badges ?? user.badges ?? identity.badges);
}

function parseBadges(value: unknown): KickAuthorBadge[] {
  const parsed = parseJsonMaybe(value);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const record = asRecord(item);
      const id = stringValue(record.type ?? record.id ?? record.name);
      if (!id) return null;
      return {
        id,
        label: stringValue(record.text ?? record.label ?? record.title),
        count: numberValue(record.count),
        raw: item,
      };
    })
    .filter((badge): badge is KickAuthorBadge => Boolean(badge));
}

function parseReply(raw: KickRawChatMessage): KickChatReply | null {
  const metadata = asRecord(raw.metadata);
  const value = raw.replyTo ?? raw.reply_to ?? metadata.original_message ?? metadata.reply_to;
  if (!value) return null;
  const reply = asRecord(parseJsonMaybe(value));
  return {
    id: stringValue(reply.id),
    authorName: stringValue(reply.username ?? reply.authorName ?? reply.author_name),
    text: stringValue(reply.content ?? reply.text),
    raw: value,
  };
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function textFromContent(value: unknown): string {
  const parsed = parseJsonMaybe(value);
  const record = asRecord(parsed);
  return stringValue(record.content ?? record.text ?? record.message) ?? stringValue(parsed) ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
