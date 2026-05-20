import { RemoteImage } from "@/ui/redesign/media/RemoteImage";

import styles from "./QueuePage.module.css";

export interface TaskThumbnailProps {
  thumbnailUrl?: string | null;
  title: string;
  platform?: string | null;
  durationLabel?: string | null;
  live?: boolean;
  chatOnly?: boolean;
}

export function TaskThumbnail({
  thumbnailUrl,
  title,
  platform,
  durationLabel,
  live,
  chatOnly,
}: TaskThumbnailProps) {
  return (
    <div className={styles.thumbnail}>
      <RemoteImage
        src={thumbnailUrl}
        alt={title}
        fallbackLabel={chatOnly ? "Chat" : live ? "Live" : platform || "VOD"}
        platform={platform}
        platformBadge={live ? "LIVE" : chatOnly ? "CHAT" : undefined}
        aspectRatio="16 / 9"
      />
      {durationLabel && !live && !chatOnly ? <span className="sr-only">{durationLabel}</span> : null}
    </div>
  );
}
