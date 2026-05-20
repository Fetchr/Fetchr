import { ipc } from "@/lib/ipc";
import type { ChatOverlaySettings, Job, JobSpec } from "@/types/job";

export class StreamDownloader {
  static enqueue(spec: JobSpec): Promise<Job> {
    return ipc.enqueueJob(spec);
  }

  static enqueueWithChat(
    spec: JobSpec,
    chatOverlay: ChatOverlaySettings,
    enabled: boolean,
  ): Promise<Job> {
    return ipc.enqueueJob({
      ...spec,
      chat_overlay: {
        ...chatOverlay,
        enabled,
        output_width: chatOverlay.output_width ?? 1920,
        output_height: chatOverlay.output_height ?? 1080,
        fps: chatOverlay.fps ?? 60,
        mode: chatOverlay.mode ?? "transparent_overlay",
      },
    });
  }

  static enqueueChatOnly(
    spec: JobSpec,
    chatOverlay: ChatOverlaySettings,
  ): Promise<Job> {
    return ipc.enqueueJob({
      ...spec,
      job_kind: "chat",
      download_kind: "video",
      chat_overlay: {
        ...chatOverlay,
        enabled: true,
        output_width: chatOverlay.output_width ?? 1920,
        output_height: chatOverlay.output_height ?? 1080,
        fps: chatOverlay.fps ?? 60,
        mode: chatOverlay.mode ?? "transparent_overlay",
      },
    });
  }
}
