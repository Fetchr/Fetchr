import { invoke } from "@tauri-apps/api/core";

import type { TwitchPublicVodPage } from "@/services/m3u8/m3u8DiscoveryTypes";
import { normalizeTwitchLogin } from "./twitchUserResolver";

export interface FetchPublicTwitchVodsRequest {
  login: string;
  first?: number;
  cursor?: string | null;
}

export async function fetchPublicTwitchVods({
  login,
  first = 20,
  cursor = null,
}: FetchPublicTwitchVodsRequest): Promise<TwitchPublicVodPage> {
  return invoke<TwitchPublicVodPage>("twitch_public_vods", {
    req: {
      login: normalizeTwitchLogin(login),
      first,
      cursor,
    },
  });
}

export function isDirectTwitchVodUrl(url: string): boolean {
  return /^https:\/\/(?:www\.)?twitch\.tv\/videos\/\d+(?:[/?#].*)?$/i.test(url.trim());
}
