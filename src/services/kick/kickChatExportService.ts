import { ipc } from "@/lib/ipc";

import { discoverKickChatReplaySource } from "./kickChatDiscovery";
import { downloadKickChatReplay } from "./kickChatDownloader";
import { normalizeKickChat } from "./kickChatNormalizer";
import { resolveKickMetadata } from "./kickMetadataService";
import {
  KICK_CHAT_REPLAY_UNAVAILABLE,
  type KickChatExportOptions,
  type KickChatExportResult,
  type KickChatExportSummary,
} from "./kickTypes";

export async function exportKickChatJson(options: KickChatExportOptions): Promise<KickChatExportResult> {
  const outputDirectory = options.outputDirectory.trim();
  if (!outputDirectory) throw new Error("Kick chat export output directory is required.");

  const baseFileName = sanitizeBaseFileName(options.baseFileName);
  const rawFileName = `${baseFileName}.kick.raw-chat.json`;
  const normalizedFileName = `${baseFileName}.kick.chat.json`;
  const rawPath = joinPath(outputDirectory, rawFileName);
  const normalizedPath = joinPath(outputDirectory, normalizedFileName);
  const writer = options.writer ?? defaultKickJsonWriter;
  const warnings: string[] = [];

  try {
    const metadata = await resolveKickMetadata(options.input, options);
    warnings.push(...metadata.warnings);

    const replaySource = await discoverKickChatReplaySource(options.input, metadata, options);
    const raw = await downloadKickChatReplay(replaySource, options);
    const messages = normalizeKickChat(raw);

    if (messages.length === 0) {
      warnings.push("Kick chat replay downloaded, but no renderable chat messages were found.");
    }

    const summary = buildSummary(messages, warnings);

    await writer(rawPath, JSON.stringify(raw, null, 2));
    await writer(normalizedPath, JSON.stringify(messages, null, 2));

    return {
      rawPath,
      normalizedPath,
      rawFileName,
      normalizedFileName,
      raw,
      messages,
      summary,
    };
  } catch (error) {
    if (String(error).includes(KICK_CHAT_REPLAY_UNAVAILABLE)) {
      throw new Error(KICK_CHAT_REPLAY_UNAVAILABLE);
    }
    throw error;
  }
}

export async function defaultKickJsonWriter(path: string, contents: string): Promise<void> {
  await ipc.writeTextFile(path, contents);
}

export function buildKickChatBaseFileName(inputName: string | null | undefined, fallback = "kick_chat"): string {
  return sanitizeBaseFileName(inputName || fallback);
}

function buildSummary(
  messages: Array<{ createdAt: string }>,
  warnings: string[],
): KickChatExportSummary {
  return {
    messageCount: messages.length,
    startTime: messages[0]?.createdAt ?? null,
    endTime: messages[messages.length - 1]?.createdAt ?? null,
    warnings,
  };
}

function sanitizeBaseFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 140);
  return sanitized || "kick_chat";
}

function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return directory.endsWith("\\") || directory.endsWith("/")
    ? `${directory}${fileName}`
    : `${directory}${separator}${fileName}`;
}
