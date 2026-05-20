import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";
import { ChatPlatformSelector, type ChatPlatform } from "./ChatPlatformSelector";

interface KickStatus {
  downloaded: boolean;
  messageCount: number | null;
  renderReady: boolean;
  warning?: string | null;
}

interface ChatOnlyExportPanelProps {
  presetName: string;
  activePresetId: string;
  presetOptions: Array<{ id: string; name: string }>;
  platform: ChatPlatform;
  sourceUrl: string;
  start: string;
  end: string;
  fileName: string;
  directory: string;
  busy: "json" | "render" | "queue" | null;
  error?: string | null;
  kickStatus: KickStatus;
  onPlatformChange: (platform: ChatPlatform) => void;
  onPresetChange: (presetId: string) => void;
  onSavePreset: () => void;
  onDuplicatePreset: () => void;
  onRenamePreset: () => void;
  onSourceUrlChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
  onDirectoryChange: (value: string) => void;
  onChooseDirectory: () => void;
  onDownloadJson: () => void;
  onRenderOnly: () => void;
  onAddToQueue: () => void;
}

export function ChatOnlyExportPanel({
  presetName,
  activePresetId,
  presetOptions,
  platform,
  sourceUrl,
  start,
  end,
  fileName,
  directory,
  busy,
  error,
  kickStatus,
  onPlatformChange,
  onPresetChange,
  onSavePreset,
  onDuplicatePreset,
  onRenamePreset,
  onSourceUrlChange,
  onStartChange,
  onEndChange,
  onFileNameChange,
  onDirectoryChange,
  onChooseDirectory,
  onDownloadJson,
  onRenderOnly,
  onAddToQueue,
}: ChatOnlyExportPanelProps) {
  const disabled = !sourceUrl.trim() || !fileName.trim() || !directory.trim() || Boolean(busy);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Только чат · {presetName}</div>
        <RedesignIcon name="chat" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Пресет чата</span>
            <div className={styles.presetSelectRow}>
              <select className={styles.select} value={activePresetId} onChange={(event) => onPresetChange(event.target.value)}>
                {presetOptions.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onDuplicatePreset} title="Создать копию пресета">
                <RedesignIcon name="copy" />
              </button>
              <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onRenamePreset} title="Переименовать пресет">
                <RedesignIcon name="preset" />
              </button>
              <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onSavePreset} title="Сохранить пресет">
                <RedesignIcon name="save" />
              </button>
            </div>
          </label>

          <ChatPlatformSelector value={platform} onChange={onPlatformChange} />

          <label className={styles.field}>
            <span className={styles.label}>Source URL</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={sourceUrl}
              placeholder={platform === "kick" ? "https://kick.com/channel/videos/..." : "https://www.twitch.tv/videos/..."}
              onChange={(event) => onSourceUrlChange(event.target.value)}
            />
          </label>

          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span className={styles.label}>Начало</span>
              <input className={`${styles.input} ${styles.mono}`} value={start} placeholder="00:00:00" onChange={(event) => onStartChange(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Конец</span>
              <input className={`${styles.input} ${styles.mono}`} value={end} placeholder="00:00:00" onChange={(event) => onEndChange(event.target.value)} />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Имя файла</span>
            <input className={styles.input} value={fileName} placeholder="stream_chat" onChange={(event) => onFileNameChange(event.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Папка сохранения</span>
            <div className={styles.twoColumn} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <input className={`${styles.input} ${styles.mono}`} value={directory} onChange={(event) => onDirectoryChange(event.target.value)} />
              <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={onChooseDirectory} title="Выбрать папку">
                <RedesignIcon name="folder" />
              </button>
            </div>
          </label>

          {platform === "kick" && (
            <div className={styles.statusCard}>
              <div className={styles.statusLine}>
                <span>Kick JSON</span>
                <span className={`${styles.statusValue} ${kickStatus.downloaded ? styles.success : ""}`}>
                  {kickStatus.downloaded ? "скачан" : "не скачан"}
                </span>
              </div>
              <div className={styles.statusLine}>
                <span>Сообщений</span>
                <span className={styles.statusValue}>{kickStatus.messageCount ?? "-"}</span>
              </div>
              <div className={styles.statusLine}>
                <span>Рендер</span>
                <span className={`${styles.statusValue} ${kickStatus.renderReady ? styles.success : ""}`}>
                  {kickStatus.renderReady ? "готов" : "ожидает JSON"}
                </span>
              </div>
              {kickStatus.warning && <div className={styles.warning}>{kickStatus.warning}</div>}
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actionStack}>
            <button className={styles.button} type="button" onClick={onDownloadJson} disabled={disabled}>
              <RedesignIcon name={busy === "json" ? "loading" : "download"} className={busy === "json" ? "animate-spin" : undefined} />
              Скачать JSON чата
            </button>
            <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onRenderOnly} disabled={disabled}>
              <RedesignIcon name={busy === "render" ? "loading" : "play"} className={busy === "render" ? "animate-spin" : undefined} />
              Рендерить только чат
            </button>
            <button className={styles.button} type="button" onClick={onAddToQueue} disabled={disabled}>
              <RedesignIcon name={busy === "queue" ? "loading" : "add"} className={busy === "queue" ? "animate-spin" : undefined} />
              Добавить экспорт в очередь
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
