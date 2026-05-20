import type { KickNormalizedChatMessage } from "@/services/kick";

import type {
  ChatRenderSourceAdapter,
  RendererChatBadge,
  RendererChatFragment,
  RendererChatMessage,
} from "./chatMessageTypes";

export class KickChatRenderAdapter implements ChatRenderSourceAdapter<KickNormalizedChatMessage> {
  toRendererMessages(messages: KickNormalizedChatMessage[]): RendererChatMessage[] {
    return messages
      .map((message) => kickMessageToRendererMessage(message))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

export function kickMessageToRendererMessage(message: KickNormalizedChatMessage): RendererChatMessage {
  return {
    timestamp: Math.max(0, message.offsetMs / 1000),
    username: slugifyUsername(message.authorName),
    display_name: message.authorName || "kick",
    user_color: message.authorColor,
    badges: message.authorBadges.map(kickBadgeToRendererBadge),
    fragments: buildRendererFragments(message),
    source_platform: "kick",
  };
}

function kickBadgeToRendererBadge(badge: KickNormalizedChatMessage["authorBadges"][number]): RendererChatBadge {
  return {
    provider: "kick",
    id: badge.id,
    version: badge.count == null ? null : String(badge.count),
    url: null,
    title: badge.label,
  };
}

function buildRendererFragments(message: KickNormalizedChatMessage): RendererChatFragment[] {
  const fragments = message.fragments.map((fragment): RendererChatFragment => {
    if (fragment.type === "emote") {
      return {
        type: "emote",
        provider: "kick",
        id: fragment.id,
        url: fragment.url ?? `https://files.kick.com/emotes/${fragment.id}/fullsize`,
        text: fragment.text,
      };
    }
    return { type: "text", text: fragment.text };
  });

  if (message.replyTo) {
    const replyText = [
      "↪ ",
      message.replyTo.authorName ? `${message.replyTo.authorName}: ` : "",
      message.replyTo.text ?? "",
      " ",
    ].join("");
    return [{ type: "text", text: replyText }, ...fragments];
  }

  return fragments.length ? fragments : [{ type: "text", text: message.text }];
}

function slugifyUsername(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return normalized || "kick";
}
