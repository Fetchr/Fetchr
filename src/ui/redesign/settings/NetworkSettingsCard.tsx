import type { ProxyConfig } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { SettingsRow } from "./GeneralSettingsCard";
import styles from "./SettingsPage.module.css";

interface NetworkSettingsCardProps {
  proxy: ProxyConfig;
  onProxyChange: (proxy: ProxyConfig) => void;
}

export function NetworkSettingsCard({ proxy, onProxyChange }: NetworkSettingsCardProps) {
  return (
    <section className={styles.card} id="settings-network">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="source" />
          Сеть
        </div>
        <div className={styles.cardHint}>Прокси для загрузок и анализа источников</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Использовать прокси" help="Включайте только если сервис не открывается или блокирует загрузку.">
          <label className={styles.toggleRow}>
            <span>{proxy.enabled ? "Включено" : "Выключено"}</span>
            <input type="checkbox" checked={proxy.enabled} onChange={(event) => onProxyChange({ ...proxy, enabled: event.target.checked })} />
          </label>
        </SettingsRow>
        <SettingsRow label="Адрес прокси" help="Неверный или медленный прокси может замедлить очередь.">
          <input
            className={`${styles.input} ${styles.mono}`}
            value={proxy.url}
            placeholder="http://127.0.0.1:2080 или socks5://..."
            onChange={(event) => onProxyChange({ ...proxy, url: event.target.value })}
          />
        </SettingsRow>
      </div>
    </section>
  );
}
