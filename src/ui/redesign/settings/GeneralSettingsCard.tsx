import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./SettingsPage.module.css";

interface GeneralSettingsCardProps {
  locale: "ru" | "en";
  directory: string;
  filenameTemplate: string;
  maxConcurrentJobs: number;
  onLocaleChange: (value: "ru" | "en") => void;
  onDirectoryChange: (value: string) => void;
  onChooseDirectory: () => void;
  onFilenameTemplateChange: (value: string) => void;
  onMaxConcurrentJobsChange: (value: number) => void;
}

export function GeneralSettingsCard({
  locale,
  directory,
  filenameTemplate,
  maxConcurrentJobs,
  onLocaleChange,
  onDirectoryChange,
  onChooseDirectory,
  onFilenameTemplateChange,
  onMaxConcurrentJobsChange,
}: GeneralSettingsCardProps) {
  const { i18n } = useTranslation();

  const setLocale = (value: "ru" | "en") => {
    onLocaleChange(value);
    void i18n.changeLanguage(value);
    localStorage.setItem("fetchr-locale", value);
  };

  return (
    <section className={styles.card} id="settings-general">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="settings" />
          Общие
        </div>
        <div className={styles.cardHint}>Базовые параметры новых задач</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Язык" help="Язык интерфейса. На скачивание и обработку не влияет.">
          <select className={styles.select} value={locale} onChange={(event) => setLocale(event.target.value as "ru" | "en")}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </SettingsRow>

        <SettingsRow label="Папка по умолчанию" help="Куда сохраняются скачанные VOD, чат и результаты обработки.">
          <div className={styles.fieldGroup}>
            <input className={`${styles.input} ${styles.mono}`} value={directory} onChange={(event) => onDirectoryChange(event.target.value)} />
            <button className={styles.button} type="button" onClick={onChooseDirectory}>
              <RedesignIcon name="folder" />
              Обзор...
            </button>
          </div>
        </SettingsRow>

        <SettingsRow label="Шаблон имени" help="Используется при создании новых задач.">
          <input className={`${styles.input} ${styles.mono}`} value={filenameTemplate} onChange={(event) => onFilenameTemplateChange(event.target.value)} />
        </SettingsRow>

        <SettingsRow label="Parallel downloads" help="Сколько задач можно выполнять одновременно. Для тяжёлого рендера обычно лучше 1.">
          <input
            className={`${styles.input} ${styles.mono}`}
            type="number"
            min={1}
            max={6}
            value={maxConcurrentJobs}
            onChange={(event) => onMaxConcurrentJobsChange(Number(event.target.value))}
          />
        </SettingsRow>
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  help,
  children,
  top,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  top?: boolean;
}) {
  return (
    <div className={`${styles.row} ${top ? styles.rowTop : ""}`}>
      <div className={styles.label}>
        <span>{label}</span>
        {help && <span className={styles.help}>{help}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
