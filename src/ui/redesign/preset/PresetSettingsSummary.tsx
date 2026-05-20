import styles from "./PresetInspector.module.css";

export interface PresetSettingsSummaryProps {
  downloadFolder: string;
  fileNameTemplate: string;
  parallelDownloads: number;
}

export function PresetSettingsSummary({
  downloadFolder,
  fileNameTemplate,
  parallelDownloads,
}: PresetSettingsSummaryProps) {
  return (
    <section className={styles.section} aria-label="Общие настройки пресета">
      <div className={styles.sectionTitle}>Общие настройки</div>
      <div className={styles.settingsList}>
        <SettingRow label="Папка загрузки" value={downloadFolder || "Не выбрана"} />
        <SettingRow label="Шаблон имени" value={fileNameTemplate || "Не задан"} />
        <SettingRow label="Parallel downloads" value={String(parallelDownloads)} />
      </div>
    </section>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>{label}</div>
      <div className={styles.settingValue} title={value}>
        {value}
      </div>
    </div>
  );
}
