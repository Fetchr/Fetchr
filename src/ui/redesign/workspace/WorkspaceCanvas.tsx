import { useMemo } from "react";
import type { RefObject } from "react";
import { GridLayout, noCompactor, type Layout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { getWorkspaceBlockDefinition } from "./workspaceBlockRegistry";
import { WorkspaceBlockFrame } from "./WorkspaceBlockFrame";
import { WorkspaceDropOverlay } from "./WorkspaceDropOverlay";
import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspaceLayout, WorkspacePanel } from "./workspaceTypes";

interface WorkspaceCanvasProps {
  layout: WorkspaceLayout;
  editMode: boolean;
  selectedPanelId: string | null;
  onSelectPanel: (panelId: string | null) => void;
  onPanelsChange: (panels: WorkspacePanel[]) => void;
  onDeletePanel: (panelId: string) => void;
  onDuplicatePanel: (panelId: string) => void;
  onToggleLock: (panelId: string) => void;
  onToggleDock: (panelId: string) => void;
  onResetPanelSize: (panelId: string) => void;
  onAddPanelAt: (type: string, x: number, y: number) => void;
}

export function WorkspaceCanvas({
  layout,
  editMode,
  selectedPanelId,
  onSelectPanel,
  onPanelsChange,
  onDeletePanel,
  onDuplicatePanel,
  onToggleLock,
  onToggleDock,
  onResetPanelSize,
  onAddPanelAt,
}: WorkspaceCanvasProps) {
  const { width, mounted, containerRef } = useContainerWidth({ initialWidth: 960 });
  const visiblePanels = layout.panels.filter((panel) => panel.visible && panel.docked);
  const gridLayout = useMemo(
    () =>
      visiblePanels.map((panel) => ({
        i: panel.id,
        x: panel.x,
        y: panel.y,
        w: panel.w,
        h: panel.h,
        minW: panel.minW,
        minH: panel.minH,
        maxW: panel.maxW,
        maxH: panel.maxH,
        isDraggable: editMode && !panel.locked,
        isResizable: editMode && !panel.locked && getWorkspaceBlockDefinition(panel.type).resizable,
        isBounded: true,
      })),
    [editMode, visiblePanels],
  );

  const handleLayoutChange = (nextLayout: Layout) => {
    const byId = new Map(nextLayout.map((item) => [item.i, item]));
    onPanelsChange(
      layout.panels.map((panel) => {
        const next = byId.get(panel.id);
        return next
          ? {
              ...panel,
              x: next.x,
              y: next.y,
              w: next.w,
              h: next.h,
            }
          : panel;
      }),
    );
  };

  return (
    <div
      className={styles.canvasWrap}
      ref={containerRef as RefObject<HTMLDivElement>}
      onPointerDown={() => editMode && onSelectPanel(null)}
      onDragOver={(event) => {
        if (!editMode) return;
        if (event.dataTransfer.types.includes("application/fetchr-panel-type")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (!editMode) return;
        const type = event.dataTransfer.getData("application/fetchr-panel-type");
        if (!type) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left + event.currentTarget.scrollLeft;
        const localY = event.clientY - rect.top + event.currentTarget.scrollTop;
        const x = Math.max(0, Math.min(11, Math.floor((localX / Math.max(1, rect.width)) * 12)));
        const y = Math.max(0, Math.floor(localY / 54));
        onAddPanelAt(type, x, y);
      }}
    >
      {editMode && <div className={styles.canvasGridBackdrop} />}
      {editMode && <WorkspaceDropOverlay />}
      {mounted && (
        <GridLayout
          width={Math.max(width, 760)}
          layout={gridLayout}
          autoSize
          gridConfig={{
            cols: 12,
            rowHeight: 44,
            margin: [10, 10],
            containerPadding: [10, 10],
            maxRows: 80,
          }}
          dragConfig={{
            enabled: editMode,
            bounded: true,
            handle: ".workspace-panel-drag-handle",
            cancel: "button,input,textarea,select,.workspace-panel-action",
            threshold: 3,
          }}
          resizeConfig={{
            enabled: editMode,
            handles: ["e", "s", "se"],
          }}
          compactor={noCompactor}
          onLayoutChange={handleLayoutChange}
          className={styles.gridLayout}
        >
          {visiblePanels.map((panel) => {
            const definition = getWorkspaceBlockDefinition(panel.type);
            const Component = definition.Component;
            return (
              <div key={panel.id}>
                <WorkspaceBlockFrame
                  panel={panel}
                  definition={definition}
                  editMode={editMode}
                  selected={selectedPanelId === panel.id}
                  onSelect={() => onSelectPanel(panel.id)}
                  onDelete={() => onDeletePanel(panel.id)}
                  onDuplicate={() => onDuplicatePanel(panel.id)}
                  onToggleLock={() => onToggleLock(panel.id)}
                  onToggleDock={() => onToggleDock(panel.id)}
                  onResetSize={() => onResetPanelSize(panel.id)}
                >
                  <Component panel={panel} mode={editMode ? "edit" : "view"} />
                </WorkspaceBlockFrame>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
