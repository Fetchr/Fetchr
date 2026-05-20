import type { ChatOverlaySettings, PerformanceSettings } from "@/types/job";

export type ChatPlatform = "twitch" | "kick" | "youtube" | "unknown";

export interface RendererChatMessage {
  timestamp: number;
  username: string;
  display_name: string;
  user_color: string | null;
  badges: RendererChatBadge[];
  fragments: RendererChatFragment[];
  source_platform: ChatPlatform | string;
}

export interface RendererChatBadge {
  provider: string;
  id: string;
  version: string | null;
  url: string | null;
  title: string | null;
}

export type RendererChatFragment =
  | { type: "text"; text: string }
  | { type: "emote"; provider: string; id: string; url: string; text: string | null };

export type ChatRenderFormat = "mov_alpha" | "webm_alpha" | "png_sequence";

export interface ChatRenderAdapterOptions {
  outputDirectory: string;
  outputName: string;
  chatOverlay: ChatOverlaySettings;
  performance: PerformanceSettings;
  binariesDir?: string | null;
}

export interface ChatRenderAdapterResult {
  rendererJsonPath: string;
  outputPath: string;
  messageCount: number;
  warnings: string[];
}

export interface ChatRenderSourceAdapter<TMessage> {
  toRendererMessages(messages: TMessage[]): RendererChatMessage[];
}

export const CHAT_QUEUE_TASK_TYPES = {
  kickChatDownload: "kick_chat_download",
  kickChatRender: "kick_chat_render",
} as const;

export type ChatQueueTaskType = (typeof CHAT_QUEUE_TASK_TYPES)[keyof typeof CHAT_QUEUE_TASK_TYPES];
