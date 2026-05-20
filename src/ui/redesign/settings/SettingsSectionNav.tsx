import { RedesignIcon, type RedesignIconName } from "@/ui/redesign/icons/iconMap";

import styles from "./SettingsPage.module.css";

export type SettingsSectionId =
  | "general"
  | "license"
  | "updates"
  | "tools"
  | "network"
  | "performance"
  | "integrations"
  | "interface"
  | "notifications"
  | "advanced";

interface SettingsSectionNavProps {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}

const sections: Array<{ id: SettingsSectionId; label: string; icon: RedesignIconName }> = [
  { id: "general", label: "Общие", icon: "settings" },
  { id: "license", label: "Лицензия и бета", icon: "secure" },
  { id: "updates", label: "Обновления", icon: "download" },
  { id: "tools", label: "Инструменты", icon: "install" },
  { id: "network", label: "Сеть", icon: "source" },
  { id: "performance", label: "Производительность", icon: "performance" },
  { id: "integrations", label: "Интеграции", icon: "link" },
  { id: "interface", label: "Интерфейс", icon: "preview" },
  { id: "notifications", label: "Уведомления", icon: "bell" },
  { id: "advanced", label: "Дополнительно", icon: "more" },
];

export function SettingsSectionNav({ activeSection, onSectionChange }: SettingsSectionNavProps) {
  return (
    <nav className={styles.nav} aria-label="Разделы настроек">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={`${styles.navButton} ${activeSection === section.id ? styles.navButtonActive : ""}`}
          onClick={() => onSectionChange(section.id)}
        >
          <RedesignIcon name={section.icon} />
          {section.label}
        </button>
      ))}
    </nav>
  );
}
