import { invoke } from "@tauri-apps/api/core";

import type { TwitchPublicVodPage, TwitchBroadcaster } from "@/services/m3u8/m3u8DiscoveryTypes";

export async function resolveTwitchUser(login: string): Promise<TwitchBroadcaster> {
  const page = await invoke<TwitchPublicVodPage>("twitch_public_vods", {
    req: {
      login: normalizeTwitchLogin(login),
      first: 1,
      cursor: null,
    },
  });
  return page.broadcaster;
}

export function normalizeTwitchLogin(login: string): string {
  return login.trim().replace(/^@/, "").toLowerCase();
}
