import type { ChatFontStyle } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";
import type { ChatOutputFormat } from "./ChatExportSettings";
import type { ChatPlatform } from "./ChatPlatformSelector";

interface ChatResultPreviewProps {
  platform: ChatPlatform;
  format: ChatOutputFormat;
  alphaBackground: boolean;
  fontFamily: string;
  fontStyle: ChatFontStyle;
  fontSize: number;
  fontWeight: number;
  usernameFontWeight: number;
  textColor: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineThickness: number;
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  showBadges: boolean;
  showBttv: boolean;
  showFfz: boolean;
  show7tv: boolean;
  cacheRemoteEmotes: boolean;
  messagesCount?: number | null;
  renderReady: boolean;
}

export function ChatResultPreview({
  platform,
  format,
  alphaBackground,
  fontFamily,
  fontStyle,
  fontSize,
  fontWeight,
  usernameFontWeight,
  textColor,
  outlineEnabled,
  outlineColor,
  outlineThickness,
  backgroundEnabled,
  backgroundOpacity,
  showBadges,
  showBttv,
  showFfz,
  show7tv,
  cacheRemoteEmotes,
  messagesCount,
  renderReady,
}: ChatResultPreviewProps) {
  const messages = platform === "kick" ? kickMessages : twitchMessages;
  const messageStyle = {
    color: textColor,
    fontFamily,
    fontSize: `${Math.max(10, Math.min(72, fontSize))}px`,
    fontStyle,
    fontWeight,
    textShadow: outlineEnabled
      ? `0 0 ${Math.max(0, outlineThickness)}px ${outlineColor}, 0 1px ${Math.max(0, outlineThickness)}px ${outlineColor}`
      : "none",
  };
  const rowStyle = {
    backgroundColor: backgroundEnabled ? `rgba(0, 0, 0, ${Math.max(0, Math.min(1, backgroundOpacity))})` : "transparent",
  };
  const enabledExtensions = [
    show7tv ? "7TV" : null,
    showBttv ? "BetterTTV" : null,
    showFfz ? "FFZ" : null,
  ].filter(Boolean).join(" / ");

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Предпросмотр результата</div>
        <RedesignIcon name="preview" />
      </div>
      <div className={styles.panelBody}>
        <div className={`${styles.chatGifPreview} ${platform === "kick" ? styles.kickGifPreview : styles.twitchGifPreview}`}>
          <div className={styles.chatPreviewStream}>
            {[...messages, ...messages].map((message, index) => (
              <div className={styles.chatPreviewMessage} style={rowStyle} key={`${message.user}-${index}`}>
                {showBadges && message.badge && <span className={styles.chatBadge}>{message.badge}</span>}
                <span className={styles.chatPreviewUser} style={{ color: message.color, fontFamily, fontWeight: usernameFontWeight }}>
                  {message.user}:
                </span>{" "}
                <span className={styles.chatPreviewText} style={messageStyle}>
                  {message.text}
                </span>
                {message.emote && <span className={styles.chatPreviewEmote}>{message.emote}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.resultCompactMeta}>
          <StatusLine label="Формат" value={format === "mov" ? "MOV" : format === "webm" ? "WebM" : "PNG sequence"} />
          <StatusLine label="Фон файла" value={alphaBackground ? "Прозрачный" : "Сплошной"} />
          <StatusLine label="Расширения" value={enabledExtensions || "выключены"} />
          <StatusLine label="Emote cache" value={cacheRemoteEmotes ? "включён" : "выключен"} />
          <StatusLine label="Сообщений" value={messagesCount == null ? "не исчезают при медленном чате" : String(messagesCount)} />
          <StatusLine label="Готовность" value={renderReady ? "Готово" : "Ожидает источник"} success={renderReady} />
        </div>
      </div>
    </section>
  );
}

const twitchMessages = [
  { user: "sllseZ", color: "#86ef2f", badge: "", text: "да", emote: "" },
  { user: "palmerok", color: "#00f58a", badge: "", text: "++++", emote: "" },
  { user: "plos_vibe", color: "#8ccfff", badge: "", text: "не твой уровень", emote: "" },
  { user: "denchik668", color: "#ff66c8", badge: "", text: "пиздець", emote: "" },
  { user: "ch4dqq", color: "#ff6bdd", badge: "", text: "Диман ты со львом жил неделю он тебя промыть должен был чтобы только на премьере гонял", emote: "" },
  { user: "morfaze_", color: "#f9a8d4", badge: "3M", text: "кирик", emote: "" },
  { user: "maammon666", color: "#86efac", badge: "SUB", text: ")", emote: "Итоги 2024" },
  { user: "antoxanotdance", color: "#a78bfa", badge: "GLHF", text: "А ЧТО БУДЕТ НА ВЫХОДЕ ))", emote: "" },
  { user: "vvrnkaaz", color: "#93c5fd", badge: "", text: "а там разве можно курит?", emote: "" },
  { user: "eby_sholi", color: "#34d399", badge: "", text: "это и есть стримфут", emote: "" },
  { user: "datuper", color: "#60a5fa", badge: "MOD", text: "Вау", emote: "" },
  { user: "lensone1", color: "#38bdf8", badge: "7TV", text: "всем привет чат, друзя hi", emote: "" },
];

const kickMessages = [
  { user: "green_chat", color: "#53fc18", badge: "VIP", text: "Kick replay style preview", emote: "" },
  { user: "viewer777", color: "#a3e635", badge: "", text: "чат тоже летит быстро", emote: "" },
  { user: "mod_kick", color: "#22c55e", badge: "MOD", text: "JSON готов к рендеру", emote: "" },
  { user: "hype_user", color: "#bbf7d0", badge: "", text: "зелёная стилистика Kick", emote: "" },
  { user: "chatflow", color: "#86efac", badge: "", text: "фон и толщина меняются live", emote: "" },
];

function StatusLine({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <div className={styles.statusLine}>
      <span>{label}</span>
      <span className={`${styles.statusValue} ${success ? styles.success : ""}`}>{value}</span>
    </div>
  );
}
