import { getWorkspaceBlockDefinition } from "./workspaceBlockRegistry";
import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspaceLayout, WorkspacePanel } from "./workspaceTypes";

interface WorkspaceFloatingPanelProps {
  layout: WorkspaceLayout;
  onDockPanel: (panelId: string) => void;
}

export function WorkspaceFloatingPanel({ layout, onDockPanel }: WorkspaceFloatingPanelProps) {
  const floatingPanels = layout.panels.filter((panel) => panel.visible && !panel.docked);
  if (floatingPanels.length === 0) return null;

  return (
    <>
      {floatingPanels.map((panel) => (
        <FloatingPanel key={panel.id} panel={panel} onDock={() => onDockPanel(panel.id)} />
      ))}
    </>
  );
}

function FloatingPanel({ panel, onDock }: { panel: WorkspacePanel; onDock: () => void }) {
  const definition = getWorkspaceBlockDefinition(panel.type);
  const Component = definition.Component;
  return (
    <aside
      className={styles.floatingPanel}
      style={{
        left: `${Math.max(16, panel.x * 32)}px`,
        top: `${Math.max(96, panel.y * 32)}px`,
        width: `${Math.max(280, panel.w * 86)}px`,
        height: `${Math.max(220, panel.h * 54)}px`,
      }}
    >
      <header className={styles.floatingHeader}>
        <span>{panel.title}</span>
        <button type="button" onClick={onDock}>Dock</button>
      </header>
      <div className={styles.floatingBody}>
        <Component panel={panel} mode="view" />
      </div>
    </aside>
  );
}
