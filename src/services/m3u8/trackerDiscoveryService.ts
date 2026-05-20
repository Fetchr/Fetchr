import { ipc } from "@/lib/ipc";

import type { TrackerDiscoveryInput, TrackerDiscoveryMeta } from "./m3u8DiscoveryTypes";

export async function discoverTrackerMetadata(input: TrackerDiscoveryInput): Promise<TrackerDiscoveryMeta> {
  const sourceUrl = input.sourceUrl?.trim();

  if (sourceUrl) {
    const meta = await ipc.twitchTrackerFetch(sourceUrl);
    return {
      username: input.username?.trim() || meta.username || null,
      streamId: input.streamId?.trim() || meta.stream_id || null,
      startTime: input.startTime?.trim() || meta.start_time || null,
      title: meta.title ?? null,
      thumbnailUrl: meta.thumbnail ?? null,
      candidates: meta.candidates ?? [],
    };
  }

  return {
    username: input.username?.trim() || null,
    streamId: input.streamId?.trim() || null,
    startTime: input.startTime?.trim() || null,
    title: null,
    thumbnailUrl: null,
    candidates: [],
  };
}
