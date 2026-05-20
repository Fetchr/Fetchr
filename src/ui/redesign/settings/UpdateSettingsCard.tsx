import { useEffect, useState } from "react";

import { ipc, type UpdateStatus } from "@/lib/ipc";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { SettingsRow } from "./GeneralSettingsCard";
import styles from "./SettingsPage.module.css";

export function UpdateSettingsCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedPath, setInstalledPath] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await ipc.checkForUpdate();
      setStatus(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const install = async () => {
    if (!status?.installer_url) return;
    setInstalling(true);
    setError(null);
    setInstalledPath(null);
    try {
      const result = await ipc.installUpdate(status.installer_url, status.installer_sha256);
      setInstalledPath(result.installer_path);
    } catch (err) {
      setError(String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className={styles.card} id="settings-updates">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="download" />
          Онлайн-обновления
        </div>
        <div className={styles.cardHint}>Проверка EXE-инсталлятора на VPS</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Версия" help="Приложение проверяет latest endpoint на VPS и показывает доступный инсталлятор.">
          <div className={styles.statusLine}>
            <span className={`${styles.statusMark} ${status?.available ? "" : styles.statusMarkDanger}`}>
              <RedesignIcon name={busy ? "loading" : status?.available ? "download" : "check"} className={busy ? "animate-spin" : undefined} />
            </span>
            <span>{versionText(status, busy)}</span>
          </div>
        </SettingsRow>

        {status?.available && (
          <SettingsRow label="Доступно" help={status.published_at ? `Опубликовано: ${status.published_at}` : undefined}>
            <div className={styles.updateBox}>
              <div className={styles.updateTitle}>
                <span>v{status.version}</span>
                {status.size_bytes != null && <span className={styles.help}>{formatBytes(status.size_bytes)}</span>}
              </div>
              {status.notes && <div className={styles.updateNotes}>{status.notes}</div>}
              {status.installer_sha256 && (
                <div className={`${styles.mono} ${styles.help}`}>sha256 {status.installer_sha256}</div>
              )}
            </div>
          </SettingsRow>
        )}

        <SettingsRow label="Действие">
          <div className={styles.fieldGroup}>
            <button className={styles.button} type="button" onClick={() => void check()} disabled={busy || installing}>
              <RedesignIcon name={busy ? "loading" : "refresh"} className={busy ? "animate-spin" : undefined} />
              Проверить
            </button>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={() => void install()}
              disabled={!status?.available || !status.installer_url || busy || installing}
            >
              <RedesignIcon name={installing ? "loading" : "install"} className={installing ? "animate-spin" : undefined} />
              Установить обновление
            </button>
          </div>
        </SettingsRow>

        {(error || status?.message || installedPath) && (
          <div className={error ? styles.errorBox : styles.placeholderCard}>
            {error || installedPathMessage(installedPath) || status?.message}
          </div>
        )}
      </div>
    </section>
  );
}

function versionText(status: UpdateStatus | null, busy: boolean) {
  if (busy && !status) return "Проверяем обновления...";
  if (!status) return "Проверка ещё не выполнялась";
  if (!status.configured) return "VPS для обновлений не настроен";
  if (status.available) return `Доступна версия v${status.version}`;
  return `Текущая версия v${status.current_version}`;
}

function installedPathMessage(path: string | null) {
  if (!path) return null;
  return `Инсталлятор скачан и запущен: ${path}`;
}

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit + 1 < units.length) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}
