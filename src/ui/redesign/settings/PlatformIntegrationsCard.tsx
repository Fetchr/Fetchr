import type { IntegrationSettings } from "@/stores/settings";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { SettingsRow } from "./GeneralSettingsCard";
import styles from "./SettingsPage.module.css";

interface PlatformIntegrationsCardProps {
  integrations: IntegrationSettings;
  onIntegrationsChange: (integrations: IntegrationSettings) => void;
  onChooseChatExportFolder: () => void;
}

export function PlatformIntegrationsCard({
  integrations,
  onIntegrationsChange,
  onChooseChatExportFolder,
}: PlatformIntegrationsCardProps) {
  const update = (patch: Partial<IntegrationSettings>) => {
    onIntegrationsChange({ ...integrations, ...patch });
  };

  return (
    <section className={styles.card} id="settings-integrations">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="link" />
          Интеграции
        </div>
        <div className={styles.cardHint}>Платформы, чат, изображения и emote cache</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Twitch Client ID" help="Текущий backend использует встроенный публичный web Client-ID для GQL. Это поле подготовлено для явной конфигурации.">
          <input
            className={`${styles.input} ${styles.mono}`}
            value={integrations.twitchClientId}
            placeholder="не задан"
            onChange={(event) =>
              update({
                twitchClientId: event.target.value,
                twitchAuthStatus: event.target.value.trim() ? "configured" : "not_configured",
              })
            }
          />
        </SettingsRow>

        <SettingsRow label="Twitch auth status">
          <span className={styles.pill}>
            {integrations.twitchAuthStatus === "configured" ? "Client ID настроен" : "Используется встроенная конфигурация"}
          </span>
        </SettingsRow>

        <SettingsRow label="Kick auth status" help="Kick chat replay работает через публичные источники и gracefully fails при изменении endpoint.">
          <span className={styles.pill}>{integrations.kickAuthStatus === "public" ? "Public / без токена" : "Не настроено"}</span>
        </SettingsRow>

        <SettingsRow label="Папка экспорта чата" help="Папка по умолчанию для JSON чата и chat-only render.">
          <div className={styles.fieldGroup}>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={integrations.chatExportFolder}
              placeholder="Использовать папку загрузок"
              onChange={(event) => update({ chatExportFolder: event.target.value })}
            />
            <button className={styles.button} type="button" onClick={onChooseChatExportFolder}>
              <RedesignIcon name="folder" />
              Обзор...
            </button>
          </div>
        </SettingsRow>

        <SettingsRow label="Remote images" help="Разрешает загрузку превью, аватаров и thumbnails из metadata платформ.">
          <label className={styles.toggleRow}>
            <span>Remote image loading</span>
            <input type="checkbox" checked={integrations.remoteImageLoading} onChange={(event) => update({ remoteImageLoading: event.target.checked })} />
          </label>
        </SettingsRow>

        <SettingsRow label="Remote emotes" help="Renderer может кешировать удалённые emote assets, когда ему нужны локальные файлы.">
          <label className={styles.toggleRow}>
            <span>Cache remote emotes</span>
            <input type="checkbox" checked={integrations.cacheRemoteEmotes} onChange={(event) => update({ cacheRemoteEmotes: event.target.checked })} />
          </label>
        </SettingsRow>
      </div>
    </section>
  );
}
