import styles from "./WorkspaceBuilderPage.module.css";

export function WorkspaceDropOverlay() {
  return (
    <div className={styles.dropOverlay} aria-hidden>
      <span>Drop zones · 12-column snap grid</span>
    </div>
  );
}
