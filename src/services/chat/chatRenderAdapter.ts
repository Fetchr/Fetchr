import { ipc } from "@/lib/ipc";
import type { KickNormalizedChatMessage } from "@/services/kick";

import type {
  ChatRenderAdapterOptions,
  ChatRenderAdapterResult,
  RendererChatMessage,
} from "./chatMessageTypes";
import { KickChatRenderAdapter } from "./kickChatRenderAdapter";

export async function writeRendererChatJson(
  messages: RendererChatMessage[],
  outputDirectory: string,
  outputName: string,
): Promise<string> {
  const path = joinPath(outputDirectory, `${sanitizeBaseFileName(outputName)}.renderer-chat.json`);
  await ipc.writeTextFile(path, JSON.stringify(messages, null, 2));
  return path;
}

export async function renderRendererChatJson(
  rendererJsonPath: string,
  options: ChatRenderAdapterOptions,
): Promise<string> {
  const result = await ipc.renderChatJson({
    chatJsonPath: rendererJsonPath,
    outputDirectory: options.outputDirectory,
    outputName: options.outputName,
    chatOverlay: options.chatOverlay,
    performance: options.performance,
    binariesDir: options.binariesDir ?? null,
  });
  return result.output_path;
}

export async function renderKickNormalizedChatJson(
  messages: KickNormalizedChatMessage[],
  options: ChatRenderAdapterOptions,
): Promise<ChatRenderAdapterResult> {
  const adapter = new KickChatRenderAdapter();
  const rendererMessages = adapter.toRendererMessages(messages);
  const warnings: string[] = [];

  if (rendererMessages.length === 0) {
    warnings.push("Kick chat JSON does not contain renderable messages.");
  }

  const rendererJsonPath = await writeRendererChatJson(
    rendererMessages,
    options.outputDirectory,
    `${options.outputName}.kick`,
  );
  const outputPath = await renderRendererChatJson(rendererJsonPath, options);

  return {
    rendererJsonPath,
    outputPath,
    messageCount: rendererMessages.length,
    warnings,
  };
}

export function parseNormalizedKickChatJson(value: string): KickNormalizedChatMessage[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Normalized Kick chat JSON must be an array.");
  }
  return parsed as KickNormalizedChatMessage[];
}

function sanitizeBaseFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .slice(0, 140) || "chat"
  );
}

function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return directory.endsWith("\\") || directory.endsWith("/")
    ? `${directory}${fileName}`
    : `${directory}${separator}${fileName}`;
}
