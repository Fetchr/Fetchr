export interface TwitchBroadcaster {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface TwitchPublicVod {
  id: string;
  title: string;
  createdAt: string;
  duration: string;
  durationSeconds: number | null;
  url: string;
  thumbnailUrl: string | null;
  viewable: "public" | "unlisted" | "private" | "unknown";
  public: boolean;
  streamId: string | null;
  chatAvailable: boolean;
}

export interface TwitchPublicVodPage {
  broadcaster: TwitchBroadcaster;
  items: TwitchPublicVod[];
  cursor: string | null;
  hasNextPage: boolean;
}

export interface TrackerDiscoveryInput {
  sourceUrl?: string;
  username?: string;
  streamId?: string;
  startTime?: string;
}

export interface TrackerDiscoveryMeta {
  username: string | null;
  streamId: string | null;
  startTime: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  candidates: string[];
}

export interface RecoveredM3u8Result {
  url: string;
  source: "recovered_m3u8";
  videoOnly: true;
  chatAvailable: false;
  warning: string;
}

export interface M3u8RecoveryResult {
  urls: RecoveredM3u8Result[];
  tried: number;
  timestampUtc: number;
}

export const RECOVERED_M3U8_CHAT_WARNING =
  "Чат недоступен для recovered m3u8. Для чата нужна прямая Twitch VOD ссылка.";
