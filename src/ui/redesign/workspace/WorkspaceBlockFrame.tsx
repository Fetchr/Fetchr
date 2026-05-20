import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspacePanel, WorkspacePanelDefinition } from "./workspaceTypes";

interface WorkspaceBlockFrameProps {
  panel: WorkspacePanel;
  definition: WorkspacePanelDefinition;
  editMode: boolean;
  selected: boolean;
  children: React.ReactNode;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onToggleDock: () => void;
  onResetSize: () => void;
}

export function WorkspaceBlockFrame({
  panel,
  definition,
  editMode,
  selected,
  children,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleLock,
  onToggleDock,
  onResetSize,
}: WorkspaceBlockFrameProps) {
  return (
    <section
      className={`${styles.blockFrame} ${selected ? styles.blockFrameSelected : ""} ${panel.locked ? styles.blockFrameLocked : ""}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <header className={`${styles.blockFrameHeader} ${editMode && !panel.locked ? "workspace-panel-drag-handle" : ""}`}>
        <div className={styles.blockFrameTitle}>
          <RedesignIcon name={definition.icon} />
          <span title={panel.title}>{panel.title}</span>
        </div>
        {editMode && (
          <div className={styles.panelActions}>
            <button type="button" className={`${styles.iconButton} workspace-panel-action`} onClick={onToggleLock} title={panel.locked ? "Разблокировать" : "Заблокировать"}>
              <RedesignIcon name={panel.locked ? "secure" : "move"} />
            </button>
            <button type="button" className={`${styles.iconButton} workspace-panel-action`} onClick={onDuplicate} disabled={!definition.duplicatable} title="Дублировать">
              <RedesignIcon name="copy" />
            </button>
            <button type="button" className={`${styles.iconButton} workspace-panel-action`} onClick={onResetSize} title="Сбросить размер">
              <RedesignIcon name="reset" />
            </button>
            <button type="button" className={`${styles.iconButton} workspace-panel-action`} onClick={onToggleDock} title={panel.docked ? "Отстыковать" : "Доковать"}>
              <RedesignIcon name={panel.docked ? "external" : "download"} />
            </button>
            <button type="button" className={`${styles.iconButton} workspace-panel-action`} onClick={onDelete} disabled={!definition.removable} title="Скрыть панель">
              <RedesignIcon name="close" />
            </button>
          </div>
        )}
      </header>
      <div className={styles.blockFrameBody}>{children}</div>
    </section>
  );
}
