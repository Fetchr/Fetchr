import { ipc } from "@/lib/ipc";

import {
  RECOVERED_M3U8_CHAT_WARNING,
  type M3u8RecoveryResult,
  type TrackerDiscoveryMeta,
} from "./m3u8DiscoveryTypes";

export async function recoverM3u8FromTrackerMeta(meta: TrackerDiscoveryMeta): Promise<M3u8RecoveryResult> {
  if (!meta.username || !meta.streamId || !meta.startTime) {
    throw new Error("Для recovery нужны никнейм, stream id и время начала.");
  }

  const result = await ipc.twitchFindM3u8({
    username: meta.username,
    stream_id: meta.streamId,
    start_time: meta.startTime,
    timezone: "local",
    window: 90,
  });

  return {
    tried: result.tried,
    timestampUtc: result.timestamp_utc,
    urls: result.urls.map((url) => ({
      url,
      source: "recovered_m3u8",
      videoOnly: true,
      chatAvailable: false,
      warning: RECOVERED_M3U8_CHAT_WARNING,
    })),
  };
}
