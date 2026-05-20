import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import {
  workspaceBlockRegistry,
  workspaceCategoryLabels,
} from "./workspaceBlockRegistry";
import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspacePanelCategory, WorkspacePanelType } from "./workspaceTypes";

const categoryOrder: WorkspacePanelCategory[] = [
  "sources",
  "queue",
  "processing",
  "chat",
  "blur",
  "diagnostics",
  "settings",
];

interface WorkspaceBlockLibraryProps {
  onAddPanel: (type: WorkspacePanelType) => void;
}

export function WorkspaceBlockLibrary({ onAddPanel }: WorkspaceBlockLibraryProps) {
  return (
    <aside className={styles.library}>
      <div className={styles.panelHeader}>
        <div>
          <h2>Библиотека блоков</h2>
          <p>Добавьте панель на workspace canvas</p>
        </div>
      </div>

      <div className={styles.libraryScroll}>
        {categoryOrder.map((category) => {
          const blocks = workspaceBlockRegistry.filter((block) => block.category === category);
          return (
            <section key={category} className={styles.librarySection}>
              <h3>{workspaceCategoryLabels[category]}</h3>
              <div className={styles.libraryList}>
                {blocks.map((block) => (
                  <button
                    key={block.type}
                    type="button"
                    className={styles.libraryItem}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/fetchr-panel-type", block.type);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onAddPanel(block.type)}
                  >
                    <span className={styles.libraryIcon}>
                      <RedesignIcon name={block.icon} />
                    </span>
                    <span className={styles.libraryText}>
                      <strong>{block.title}</strong>
                      <span>{block.description}</span>
                    </span>
                    <RedesignIcon name="add" className={styles.libraryAddIcon} />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
