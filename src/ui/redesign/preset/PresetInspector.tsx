import { useState } from "react";

import { cn } from "@/lib/utils";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./PresetInspector.module.css";
import { PresetSettingsSummary } from "./PresetSettingsSummary";
import { PresetStepList, type PresetStep } from "./PresetStepList";

export interface PresetInspectorProps {
  presetName: string;
  downloadFolder: string;
  fileNameTemplate: string;
  parallelDownloads: number;
  steps: readonly PresetStep[];
  onEditPreset: () => void;
  className?: string;
}

type PresetInspectorTab = "properties" | "template";

export function PresetInspector({
  presetName,
  downloadFolder,
  fileNameTemplate,
  parallelDownloads,
  steps,
  onEditPreset,
  className,
}: PresetInspectorProps) {
  const [activeTab, setActiveTab] = useState<PresetInspectorTab>("properties");

  return (
    <aside className={cn(fetchrThemeClassName, styles.inspector, className)} aria-label="Инспектор пресета">
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Текущий пресет</div>
          <div className={styles.title}>{presetName}</div>
        </div>
        <button className={styles.moreButton} type="button" aria-label="Дополнительные действия">
          <RedesignIcon name="more" className="size-[15px]" />
        </button>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Разделы пресета">
        <button
          className={cn(styles.tab, activeTab === "properties" && styles.tabActive)}
          type="button"
          role="tab"
          aria-selected={activeTab === "properties"}
          onClick={() => setActiveTab("properties")}
        >
          Свойства
        </button>
        <button
          className={cn(styles.tab, activeTab === "template" && styles.tabActive)}
          type="button"
          role="tab"
          aria-selected={activeTab === "template"}
          onClick={() => setActiveTab("template")}
        >
          Шаблон
        </button>
      </div>

      <PresetSettingsSummary
        downloadFolder={downloadFolder}
        fileNameTemplate={fileNameTemplate}
        parallelDownloads={parallelDownloads}
      />
      <PresetStepList steps={steps} />

      <div className={styles.footer}>
        <button className={styles.editButton} type="button" onClick={onEditPreset}>
          <RedesignIcon name="preset" className="size-[15px]" />
          Редактировать пресет
        </button>
      </div>
    </aside>
  );
}
