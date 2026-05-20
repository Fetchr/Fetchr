import styles from "./ChatRenderPage.module.css";

export type ChatPlatform = "twitch" | "kick";

interface ChatPlatformSelectorProps {
  value: ChatPlatform;
  onChange: (value: ChatPlatform) => void;
}

export function ChatPlatformSelector({ value, onChange }: ChatPlatformSelectorProps) {
  return (
    <div className={styles.segmented} role="tablist" aria-label="Платформа чата">
      {(["twitch", "kick"] as const).map((platform) => (
        <button
          className={`${styles.segment} ${value === platform ? styles.segmentActive : ""}`}
          key={platform}
          type="button"
          onClick={() => onChange(platform)}
        >
          {platform === "twitch" ? "Twitch" : "Kick"}
        </button>
      ))}
    </div>
  );
}
