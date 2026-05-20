import { useJobCounts, useQueue } from "@/stores/queue";
import { presetFeatureCatalog, usePresets } from "@/stores/presets";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { QueuePage } from "@/ui/redesign/queue";
import { M3U8FinderPage } from "@/ui/redesign/m3u8";
import { ChatRenderPage } from "@/ui/redesign/chat-render";
import { SponsorBlurPage } from "@/ui/redesign/sponsor-blur";
import { LogsPage } from "@/ui/redesign/logs";
import { SettingsPage } from "@/ui/redesign/settings";
import { PresetInspector } from "@/ui/redesign/preset";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./WorkspaceBuilderPage.module.css";
import type {
  WorkspacePanel,
  WorkspacePanelCategory,
  WorkspacePanelDefinition,
  WorkspacePanelRenderProps,
  WorkspacePanelType,
} from "./workspaceTypes";

export const workspaceCategoryLabels: Record<WorkspacePanelCategory, string> = {
  sources: "Источники",
  queue: "Очередь",
  processing: "Обработка",
  chat: "Чат",
  blur: "Блюр",
  diagnostics: "Диагностика",
  settings: "Настройки",
};

export const workspaceBlockRegistry: WorkspacePanelDefinition[] = [
  panel("queue_table", "Очередь задач", "Таблица активных, ожидающих и завершённых загрузок.", "queue", "queue", QueueTableBlock, 7, 7, 4, 4, false),
  panel("task_details", "Детали задачи", "Источник, статус и прогресс выбранной задачи.", "queue", "info", TaskDetailsBlock, 4, 5, 3, 3),
  panel("preset_inspector", "Текущий пресет", "Настройки скачивания и обработки из активного preset.", "processing", "preset", PresetInspectorBlock, 3, 7, 3, 4, false),
  panel("add_task", "Добавить задачу", "Быстрый блок добавления Twitch, YouTube, Kick, m3u8 или RTMP.", "sources", "add", AddTaskBlock, 5, 5, 4, 4),
  panel("system_status", "Системный статус", "Движок, потоки и состояние очереди.", "diagnostics", "status", SystemStatusBlock, 3, 4, 3, 3),
  panel("logs", "Логи", "Последние сообщения задач и системные события.", "diagnostics", "logs", LogsBlock, 5, 4, 3, 3),
  panel("m3u8_public_search", "M3U8 Public Search", "Поиск публичных Twitch VOD по нику.", "sources", "finder", M3U8PublicSearchBlock, 4, 4, 3, 3),
  panel("m3u8_recovered_results", "M3U8 Recovered Results", "Video-only recovered m3u8 без чата.", "sources", "link", M3U8RecoveredResultsBlock, 5, 4, 3, 3),
  panel("chat_preview", "Chat Preview", "Позиция и размер chat overlay в 1920x1080.", "chat", "preview", ChatPreviewBlock, 5, 5, 4, 4),
  panel("chat_export", "Chat Export", "Twitch/Kick JSON и render-only экспорт.", "chat", "chat", ChatExportBlock, 4, 4, 3, 3),
  panel("sponsor_blur_preview", "Sponsor Blur Preview", "Кадр видео с зонами блюра.", "blur", "blur", SponsorBlurPreviewBlock, 5, 5, 4, 4),
  panel("sponsor_zone_list", "Sponsor Zones", "Список зон, эффекты и видимость.", "blur", "logs", SponsorZoneListBlock, 4, 4, 3, 3),
  panel("settings_summary", "Settings Summary", "Папка загрузки, потоки, сеть и интеграции.", "settings", "settings", SettingsSummaryBlock, 4, 4, 3, 3),
];

export function getWorkspaceBlockDefinition(type: WorkspacePanelType): WorkspacePanelDefinition {
  return workspaceBlockRegistry.find((item) => item.type === type) ?? workspaceBlockRegistry[0];
}

export function createWorkspacePanel(
  type: WorkspacePanelType,
  overrides: Partial<WorkspacePanel> = {},
): WorkspacePanel {
  const definition = getWorkspaceBlockDefinition(type);
  return {
    id: overrides.id ?? `${type}-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    type,
    title: overrides.title ?? definition.title,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? definition.defaultSize.w,
    h: overrides.h ?? definition.defaultSize.h,
    minW: overrides.minW ?? definition.minSize.w,
    minH: overrides.minH ?? definition.minSize.h,
    maxW: overrides.maxW,
    maxH: overrides.maxH,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    docked: overrides.docked ?? true,
    tabGroupId: overrides.tabGroupId,
    props: { ...definition.defaultProps, ...(overrides.props ?? {}) },
  };
}

function panel(
  type: WorkspacePanelType,
  title: string,
  description: string,
  category: WorkspacePanelCategory,
  icon: WorkspacePanelDefinition["icon"],
  Component: WorkspacePanelDefinition["Component"],
  w: number,
  h: number,
  minW: number,
  minH: number,
  removable = true,
): WorkspacePanelDefinition {
  return {
    type,
    title,
    description,
    category,
    icon,
    Component,
    defaultSize: { w, h },
    minSize: { w: minW, h: minH },
    defaultProps: {},
    resizable: true,
    removable,
    duplicatable: true,
  };
}

function BlockShell({ panel, children }: WorkspacePanelRenderProps & { children: React.ReactNode }) {
  const definition = getWorkspaceBlockDefinition(panel.type);
  return (
    <div className={styles.runtimeBlock}>
      <div className={styles.runtimeBlockTitle}>
        <RedesignIcon name={definition.icon} />
        <span>{panel.title}</span>
      </div>
      {children}
    </div>
  );
}

function QueueTableBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <QueuePage />
      </div>
    </BlockShell>
  );
}

function TaskDetailsBlock(props: WorkspacePanelRenderProps) {
  const job = useQueue((state) => state.jobs.find((item) => item.status === "running") ?? state.jobs[0]);
  return (
    <BlockShell {...props}>
      <Metric label="Задача" value={job?.spec.name ?? "Не выбрана"} />
      <Metric label="Статус" value={job?.status ?? "Ожидание"} />
      <Metric label="Источник" value={job?.spec.url ?? "Нет активной ссылки"} />
    </BlockShell>
  );
}

function PresetInspectorBlock(props: WorkspacePanelRenderProps) {
  const presets = usePresets((state) => state.presets);
  const activePresetId = usePresets((state) => state.activePresetId);
  const directory = useSettings((state) => state.directory);
  const filenameTemplate = useSettings((state) => state.filenameTemplate);
  const maxConcurrentJobs = useSettings((state) => state.maxConcurrentJobs);
  const active = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const steps = (active?.features ?? []).map((id) => {
    const feature = presetFeatureCatalog.find((item) => item.id === id);
    return {
      id,
      title: feature?.title ?? id,
      description: feature?.description,
    };
  });
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <PresetInspector
          presetName={active?.name ?? "Fast Save"}
          downloadFolder={directory || active?.runtime.directory || ""}
          fileNameTemplate={filenameTemplate}
          parallelDownloads={maxConcurrentJobs}
          steps={steps}
          onEditPreset={() => undefined}
        />
      </div>
    </BlockShell>
  );
}

function AddTaskBlock(props: WorkspacePanelRenderProps) {
  const openAddDialog = useUI((state) => state.openAddDialog);
  return (
    <BlockShell {...props}>
      <div className={styles.fakeInput}>https://twitch.tv/channel или Kick VOD URL</div>
      <div className={styles.inlineButtons}>
        <button type="button" onClick={openAddDialog}>Открыть рабочую форму</button>
        <span>Анализ, preview и добавление выполняются в существующей модалке</span>
      </div>
    </BlockShell>
  );
}

function SystemStatusBlock(props: WorkspacePanelRenderProps) {
  const counts = useJobCounts();
  return (
    <BlockShell {...props}>
      <Metric label="Движок" value="Активен" />
      <Metric label="Активные" value={String(counts.running)} />
      <Metric label="В очереди" value={String(counts.queued)} />
    </BlockShell>
  );
}

function LogsBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <LogsPage />
      </div>
    </BlockShell>
  );
}

function M3U8PublicSearchBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <M3U8FinderPage />
      </div>
    </BlockShell>
  );
}

function M3U8RecoveredResultsBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <M3U8FinderPage />
      </div>
    </BlockShell>
  );
}

function ChatPreviewBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <ChatRenderPage />
      </div>
    </BlockShell>
  );
}

function ChatExportBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <ChatRenderPage />
      </div>
    </BlockShell>
  );
}

function SponsorBlurPreviewBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <SponsorBlurPage />
      </div>
    </BlockShell>
  );
}

function SponsorZoneListBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <SponsorBlurPage />
      </div>
    </BlockShell>
  );
}

function SettingsSummaryBlock(props: WorkspacePanelRenderProps) {
  return (
    <BlockShell {...props}>
      <div className={styles.embeddedPanelPage}>
        <SettingsPage />
      </div>
    </BlockShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}
