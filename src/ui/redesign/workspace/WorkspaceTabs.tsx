import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./WorkspaceBuilderPage.module.css";

export interface WorkspaceTabItem {
  id: string;
  name: string;
  custom?: boolean;
}

interface WorkspaceTabsProps {
  workspaces: WorkspaceTabItem[];
  activeWorkspaceId: string;
  onSelect: (workspaceId: string) => void;
  onCreate: () => void;
}

export function WorkspaceTabs({ workspaces, activeWorkspaceId, onSelect, onCreate }: WorkspaceTabsProps) {
  return (
    <nav className={styles.workspaceTabs} aria-label="Workspace tabs">
      {workspaces.map((workspace) => (
        <button
          key={workspace.id}
          type="button"
          className={`${styles.workspaceTab} ${workspace.id === activeWorkspaceId ? styles.workspaceTabActive : ""}`}
          onClick={() => onSelect(workspace.id)}
        >
          {workspace.name}
        </button>
      ))}
      <button type="button" className={styles.workspaceTabAdd} onClick={onCreate}>
        <RedesignIcon name="add" />
        Новый workspace
      </button>
    </nav>
  );
}
