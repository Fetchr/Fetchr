import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { ipc, type BetaActivationLink, type LicenseStatus } from "@/lib/ipc";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { SettingsRow } from "./GeneralSettingsCard";
import styles from "./SettingsPage.module.css";

interface LicenseSettingsCardProps {
  license: LicenseStatus | null;
  resetting: boolean;
  onResetLicense: () => void;
}

export function LicenseSettingsCard({ license, resetting, onResetLicense }: LicenseSettingsCardProps) {
  const [copied, setCopied] = useState(false);
  const [activationLink, setActivationLink] = useState<BetaActivationLink | null>(null);
  const active = license?.state === "active";

  useEffect(() => {
    void ipc.betaActivationLink().then(setActivationLink).catch(() => undefined);
  }, []);

  const copyMachineId = async () => {
    if (!license?.machine_id) return;
    await navigator.clipboard.writeText(license.machine_id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const openTelegramBot = async () => {
    if (activationLink?.telegram_url) {
      await openUrl(activationLink.telegram_url);
      return;
    }
    await copyMachineId();
  };

  return (
    <section className={styles.card} id="settings-license">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="secure" />
          Лицензия и бета
        </div>
        <div className={styles.cardHint}>Проверка остаётся в текущем license backend</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Статус" help="Ключ проверяется существующим механизмом лицензирования.">
          <div className={styles.statusLine}>
            <span className={`${styles.statusMark} ${active ? "" : styles.statusMarkDanger}`}>
              <RedesignIcon name={active ? "check" : "clear"} />
            </span>
            <span>{statusText(license)}</span>
          </div>
        </SettingsRow>

        <SettingsRow label="Machine ID" help="Этот код нужен для выдачи персонального beta-ключа.">
          <div className={styles.fieldGroup}>
            <input className={`${styles.input} ${styles.mono}`} value={license?.machine_id ?? ""} readOnly />
            <button className={styles.button} type="button" onClick={copyMachineId} disabled={!license?.machine_id}>
              <RedesignIcon name={copied ? "check" : "copy"} />
              {copied ? "ОК" : "Копировать"}
            </button>
            <button className={styles.button} type="button" onClick={openTelegramBot} disabled={!license?.machine_id}>
              <RedesignIcon name="external" />
              Telegram
            </button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Telegram bot"
          help="Приложение передаёт Machine ID в Telegram-бота, а бот генерирует ключ с привязкой к железу."
        >
          <div className={styles.statusLine}>
            <span className={`${styles.statusMark} ${activationLink?.configured ? "" : styles.statusMarkDanger}`}>
              <RedesignIcon name={activationLink?.configured ? "check" : "alert"} />
            </span>
            <span>
              {activationLink?.configured
                ? "Бот настроен, можно выдавать ключи через Telegram"
                : "Для сборки задайте FETCHR_TG_BETA_BOT"}
            </span>
          </div>
        </SettingsRow>

        {license?.license && (
          <SettingsRow label="Выдано">
            <div className={styles.statusLine}>
              <RedesignIcon name="key" />
              <span>{license.license.name || license.license.note || "Beta tester"}</span>
              <span className={`${styles.mono} ${styles.help}`}>{license.license.issued_at}</span>
            </div>
          </SettingsRow>
        )}

        <SettingsRow label="Сброс" help="Удаляет сохранённый ключ. Валидация ключа не меняется.">
          <button className={`${styles.button} ${styles.dangerButton}`} type="button" onClick={onResetLicense} disabled={resetting}>
            <RedesignIcon name={resetting ? "loading" : "reset"} className={resetting ? "animate-spin" : undefined} />
            Сбросить ключ
          </button>
        </SettingsRow>
      </div>
    </section>
  );
}

function statusText(license: LicenseStatus | null) {
  if (!license) return "Проверяем...";
  if (license.state === "active") return "Активирована";
  if (license.state === "invalid") return "Ключ повреждён или не подходит";
  return "Ключ не введён";
}
