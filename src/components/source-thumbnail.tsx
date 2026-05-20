import { Film, MessageSquareText, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { platformLabel, type Platform } from "@/lib/url";

interface SourceThumbnailProps {
  thumbnail?: string | null;
  platform?: Platform | string | null;
  title?: string | null;
  duration?: number | null;
  live?: boolean;
  chatOnly?: boolean;
  className?: string;
}

export function SourceThumbnail({
  thumbnail,
  platform,
  title,
  duration,
  live,
  chatOnly,
  className,
}: SourceThumbnailProps) {
  const platformText = platformLabel((platform ?? "unknown") as Platform);

  return (
    <div
      className={cn(
        "relative h-[54px] w-24 shrink-0 overflow-hidden rounded border border-border-subtle bg-[#111821]",
        className,
      )}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={title ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(55,138,221,0.22),transparent_38%),linear-gradient(135deg,#151b24,#0b0f15)] text-fg-tertiary">
          {chatOnly ? (
            <MessageSquareText className="h-5 w-5" strokeWidth={1.6} />
          ) : live ? (
            <Radio className="h-5 w-5" strokeWidth={1.6} />
          ) : (
            <Film className="h-5 w-5" strokeWidth={1.6} />
          )}
        </div>
      )}
      <div className="absolute left-1 top-1 rounded-sm bg-black/72 px-1.5 py-[1px] font-mono text-[8.5px] font-semibold uppercase text-white/90">
        {live ? "LIVE" : chatOnly ? "CHAT" : platformText}
      </div>
      {duration != null && duration > 0 && (
        <div className="absolute bottom-1 right-1 rounded-sm bg-black/72 px-1.5 py-[1px] font-mono text-[9px] text-white/90">
          {formatDuration(duration)}
        </div>
      )}
    </div>
  );
}
