import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./AddTaskModal.module.css";

export type AddTaskSource = "twitch" | "youtube" | "kick" | "m3u8" | "rtmp";

export interface SourceTabsProps {
  activeSource: AddTaskSource;
  onSourceChange: (source: AddTaskSource) => void;
}

const tabs: Array<{ id: AddTaskSource; label: string; platform: string }> = [
  { id: "twitch", label: "twitch.tv", platform: "twitch" },
  { id: "youtube", label: "youtube.com", platform: "youtube" },
  { id: "kick", label: "kick.com", platform: "kick" },
  { id: "m3u8", label: "m3u8", platform: "hls" },
  { id: "rtmp", label: "rtmp", platform: "rtmp" },
];

export function SourceTabs({ activeSource, onSourceChange }: SourceTabsProps) {
  return (
    <div className={styles.tabShell}>
      <div className={styles.tabs} role="tablist" aria-label="Тип источника">
        {tabs.map((tab) => (
          <button
            className={cn(styles.tab, activeSource === tab.id && styles.tabActive)}
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeSource === tab.id}
            onClick={() => onSourceChange(tab.id)}
          >
            <PlatformIcon platform={tab.platform} className="size-[16px]" />
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
