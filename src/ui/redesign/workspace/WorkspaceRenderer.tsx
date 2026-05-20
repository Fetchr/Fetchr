import { useMemo, useState } from "react";

import { getWorkspaceBlockDefinition } from "./workspaceBlockRegistry";
import { WorkspaceFloatingPanel } from "./WorkspaceFloatingPanel";
import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspaceLayout, WorkspacePanel, WorkspaceRenderMode } from "./workspaceTypes";

interface WorkspaceRendererProps {
  layout: WorkspaceLayout;
  mode?: WorkspaceRenderMode;
  onDockPanel?: (panelId: string) => void;
}

export function WorkspaceRenderer({ layout, mode = "view", onDockPanel }: WorkspaceRendererProps) {
  const panels = layout.panels.filter((panel) => panel.visible && panel.docked);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const renderItems = useMemo(() => buildRenderItems(panels), [panels]);

  return (
    <div className={styles.rendererSurface}>
      <div className={styles.rendererGrid}>
        {renderItems.map((item) => {
          if (item.kind === "panel") {
            return <PanelItem key={item.panel.id} panel={item.panel} mode={mode} />;
          }
          const activePanelId = activeTabs[item.id] ?? item.panels[0]?.id;
          const activePanel = item.panels.find((panel) => panel.id === activePanelId) ?? item.panels[0];
          if (!activePanel) return null;
          return (
            <div
              key={item.id}
              className={styles.rendererItem}
              style={{
                gridColumn: `${item.x + 1} / span ${item.w}`,
                gridRow: `${item.y + 1} / span ${item.h}`,
              }}
            >
              <div className={styles.tabGroupHeader}>
                {item.panels.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className={panel.id === activePanel.id ? styles.tabGroupButtonActive : styles.tabGroupButton}
                    onClick={() => setActiveTabs((current) => ({ ...current, [item.id]: panel.id }))}
                  >
                    {panel.title}
                  </button>
                ))}
              </div>
              <div className={styles.tabGroupBody}>
                <PanelContent panel={activePanel} mode={mode} />
              </div>
            </div>
          );
        })}
      </div>
      <WorkspaceFloatingPanel layout={layout} onDockPanel={onDockPanel ?? (() => undefined)} />
    </div>
  );
}

function PanelItem({ panel, mode }: { panel: WorkspacePanel; mode: WorkspaceRenderMode }) {
  return (
    <div
      className={styles.rendererItem}
      style={{
        gridColumn: `${panel.x + 1} / span ${panel.w}`,
        gridRow: `${panel.y + 1} / span ${panel.h}`,
      }}
    >
      <PanelContent panel={panel} mode={mode} />
    </div>
  );
}

function PanelContent({ panel, mode }: { panel: WorkspacePanel; mode: WorkspaceRenderMode }) {
  const definition = getWorkspaceBlockDefinition(panel.type);
  const Component = definition.Component;
  return <Component panel={panel} mode={mode} />;
}

type RenderItem =
  | { kind: "panel"; panel: WorkspacePanel }
  | { kind: "group"; id: string; panels: WorkspacePanel[]; x: number; y: number; w: number; h: number };

function buildRenderItems(panels: WorkspacePanel[]): RenderItem[] {
  const grouped = new Map<string, WorkspacePanel[]>();
  const items: RenderItem[] = [];
  for (const panel of panels) {
    if (!panel.tabGroupId) {
      items.push({ kind: "panel", panel });
      continue;
    }
    grouped.set(panel.tabGroupId, [...(grouped.get(panel.tabGroupId) ?? []), panel]);
  }
  for (const [id, groupPanels] of grouped) {
    const anchor = groupPanels[0];
    items.push({
      kind: "group",
      id,
      panels: groupPanels,
      x: anchor.x,
      y: anchor.y,
      w: Math.max(...groupPanels.map((panel) => panel.w)),
      h: Math.max(...groupPanels.map((panel) => panel.h)),
    });
  }
  return items;
}
