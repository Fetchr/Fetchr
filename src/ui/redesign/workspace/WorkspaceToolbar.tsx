import { Button } from "@/components/ui/button";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspaceMode } from "./workspaceTypes";

interface WorkspaceToolbarProps {
  mode: WorkspaceMode;
  dirty: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onResetSaved: () => void;
  onResetDefault: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function WorkspaceToolbar({
  mode,
  dirty,
  onEnterEdit,
  onSave,
  onCancel,
  onResetSaved,
  onResetDefault,
  onDuplicate,
  onRename,
  onDelete,
}: WorkspaceToolbarProps) {
  return (
    <header className={styles.workspaceToolbar}>
      <div className={styles.toolbarTitle}>
        <h1>Рабочее пространство</h1>
        <p>Панели Fetchr можно докать, двигать и сохранять как workspace layout.</p>
      </div>
      <div className={styles.toolbarActions}>
        {mode === "view" ? (
          <Button variant="primary" size="md" onClick={onEnterEdit}>
            <RedesignIcon name="move" />
            Редактировать workspace
          </Button>
        ) : (
          <>
            <Button variant="primary" size="md" onClick={onSave}>
              <RedesignIcon name="save" />
              {dirty ? "Сохранить layout *" : "Сохранить layout"}
            </Button>
            <Button variant="secondary" size="md" onClick={onCancel}>
              <RedesignIcon name="close" />
              Отмена
            </Button>
            <Button variant="secondary" size="md" onClick={onResetSaved}>
              <RedesignIcon name="reset" />
              К сохранённому
            </Button>
            <Button variant="secondary" size="md" onClick={onResetDefault}>
              <RedesignIcon name="refresh" />
              Default
            </Button>
          </>
        )}
        <Button variant="secondary" size="md" onClick={onDuplicate}>
          <RedesignIcon name="copy" />
          Duplicate
        </Button>
        <Button variant="secondary" size="md" onClick={onRename}>
          <RedesignIcon name="preset" />
          Rename
        </Button>
        <Button variant="secondary" size="md" onClick={onDelete}>
          <RedesignIcon name="trash" />
          Delete
        </Button>
      </div>
    </header>
  );
}
