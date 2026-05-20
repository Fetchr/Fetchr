import { useEffect, useState } from "react";

import { ipc, type HardwarePreset, type LicenseStatus } from "@/lib/ipc";
import {
  defaultPerformanceSettings,
  useSettings,
} from "@/stores/settings";
import type { BinaryReport, PerformanceSettings } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import { GeneralSettingsCard } from "./GeneralSettingsCard";
import { LicenseSettingsCard } from "./LicenseSettingsCard";
import { NetworkSettingsCard } from "./NetworkSettingsCard";
import { PerformanceSettingsCard } from "./PerformanceSettingsCard";
import { PlatformIntegrationsCard } from "./PlatformIntegrationsCard";
import { SettingsSectionNav, type SettingsSectionId } from "./SettingsSectionNav";
import styles from "./SettingsPage.module.css";
import { ToolsSettingsCard } from "./ToolsSettingsCard";
import { UpdateSettingsCard } from "./UpdateSettingsCard";

export function SettingsPage() {
  const settings = useSettings();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [binaries, setBinaries] = useState<BinaryReport[]>([]);
  const [hardware, setHardware] = useState<HardwarePreset | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [detectingHardware, setDetectingHardware] = useState(false);
  const [resettingLicense, setResettingLicense] = useState(false);
  const performance = settings.performance ?? defaultPerformanceSettings;

  useEffect(() => {
    if (!settings.directory) {
      void ipc.defaultDownloadDir().then((directory) => {
        if (directory) settings.setDirectory(directory);
      });
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void ipc.detectBinaries(settings.binariesDir).then((reports) => {
      if (!cancelled) setBinaries(reports);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.binariesDir]);

  useEffect(() => {
    void detectHardware(false);
    void ipc.licenseStatus().then(setLicense).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDirectory = async () => {
    const directory = await ipc.chooseDirectory();
    if (directory) settings.setDirectory(directory);
  };

  const chooseBinariesDir = async () => {
    const directory = await ipc.chooseDirectory();
    if (directory) settings.setBinariesDir(directory);
  };

  const chooseChatExportFolder = async () => {
    const directory = await ipc.chooseDirectory();
    if (directory) {
      settings.setIntegrations({ ...settings.integrations, chatExportFolder: directory });
    }
  };

  const detectHardware = async (apply: boolean) => {
    setDetectingHardware(true);
    try {
      const preset = await ipc.detectHardwarePreset();
      setHardware(preset);
      if (apply) applyHardwarePreset(preset);
    } finally {
      setDetectingHardware(false);
    }
  };

  const applyHardwarePreset = (preset: HardwarePreset) => {
    settings.setPerformance({
      ...defaultPerformanceSettings,
      ...preset.performance,
    });
    settings.setChatOverlay({
      ...settings.chatOverlay,
      compose_mode: "direct",
      alpha_output_format: "mov_qtrle",
      chat_overlay_fps: 60,
      save_alpha_overlay: false,
      save_clean_video: true,
    });
  };

  const resetLicense = async () => {
    setResettingLicense(true);
    try {
      const next = await ipc.resetLicense();
      setLicense(next);
      window.setTimeout(() => window.location.reload(), 250);
    } finally {
      setResettingLicense(false);
    }
  };

  const changeSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Настройки</h1>
          <div className={styles.subtitle}>Папки, лицензия, инструменты, сеть, производительность и интеграции Fetchr.</div>
        </div>
      </header>

      <div className={styles.layout}>
        <SettingsSectionNav activeSection={activeSection} onSectionChange={changeSection} />
        <main className={styles.content}>
          <div className={styles.stack}>
            <GeneralSettingsCard
              locale={settings.locale}
              directory={settings.directory}
              filenameTemplate={settings.filenameTemplate}
              maxConcurrentJobs={settings.maxConcurrentJobs}
              onLocaleChange={settings.setLocale}
              onDirectoryChange={settings.setDirectory}
              onChooseDirectory={() => void chooseDirectory()}
              onFilenameTemplateChange={settings.setFilenameTemplate}
              onMaxConcurrentJobsChange={settings.setMaxConcurrentJobs}
            />

            <LicenseSettingsCard
              license={license}
              resetting={resettingLicense}
              onResetLicense={() => void resetLicense()}
            />

            <UpdateSettingsCard />

            <ToolsSettingsCard
              binariesDir={settings.binariesDir}
              binaries={binaries}
              onBinariesDirChange={settings.setBinariesDir}
              onChooseBinariesDir={() => void chooseBinariesDir()}
            />

            <NetworkSettingsCard proxy={settings.proxy} onProxyChange={settings.setProxy} />

            <PerformanceSettingsCard
              performance={performance}
              hardware={hardware}
              detectingHardware={detectingHardware}
              onPerformanceChange={(next: PerformanceSettings) => settings.setPerformance(next)}
              onDetectHardware={(apply) => void detectHardware(apply)}
            />

            <PlatformIntegrationsCard
              integrations={settings.integrations}
              onIntegrationsChange={settings.setIntegrations}
              onChooseChatExportFolder={() => void chooseChatExportFolder()}
            />

            <PlaceholderSection id="interface" title="Интерфейс" icon="preview">
              Тема редизайна подключена локально к новым экранам и не перезаписывает старый UI.
            </PlaceholderSection>
            <PlaceholderSection id="notifications" title="Уведомления" icon="bell">
              Системные уведомления пока используют текущую очередь и лог-события приложения.
            </PlaceholderSection>
            <PlaceholderSection id="advanced" title="Дополнительно" icon="more">
              Расширенные параметры будут добавляться сюда без изменения контрактов загрузки.
            </PlaceholderSection>
          </div>
        </main>
      </div>
    </div>
  );
}

function PlaceholderSection({
  id,
  title,
  icon,
  children,
}: {
  id: SettingsSectionId;
  title: string;
  icon: "preview" | "bell" | "more";
  children: string;
}) {
  return (
    <section className={styles.card} id={`settings-${id}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name={icon} />
          {title}
        </div>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.placeholderCard}>{children}</div>
      </div>
    </section>
  );
}
