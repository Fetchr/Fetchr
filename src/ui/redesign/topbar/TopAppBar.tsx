import type { ChangeEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import fetchrLogo from "@/assets/fetchr-logo.png";
import { cn } from "@/lib/utils";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./TopAppBar.module.css";

export type TopAppBarWorkspace =
  | string
  | {
      id: string;
      label: string;
    };

export interface TopAppBarProps {
  version: string;
  activeWorkspace: string;
  workspaces: readonly TopAppBarWorkspace[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onAddTask: () => void;
  onRunAll: () => void;
  onOpenSettings: () => void;
  notificationCount?: number;
  onWorkspaceChange?: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
  onOpenNotifications?: () => void;
  hideWorkspaceTabs?: boolean;
  className?: string;
}

export function TopAppBar({
  version,
  searchValue,
  onSearchChange,
  onAddTask,
  onRunAll,
  onOpenSettings,
  notificationCount = 0,
  onOpenNotifications,
  className,
}: TopAppBarProps) {
  const currentWindow = getCurrentWindow();
  const visibleNotificationCount = Math.max(0, notificationCount);

  return (
    <div className={cn(fetchrThemeClassName, "drag-region", styles.topBar, className)}>
      <div className={styles.brandGroup}>
        <div className={styles.brandMark} aria-hidden>
          <img className={styles.brandImage} src={fetchrLogo} alt="" />
        </div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>Fetchr</span>
          <span className={styles.version}>{version}</span>
        </div>
      </div>

      <div className={styles.centerArea}>
        <label className={cn("no-drag", styles.searchBox)}>
          <span className="sr-only">Поиск</span>
          <RedesignIcon name="finder" className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="search"
            value={searchValue}
            placeholder="Поиск по задачам, источникам, пресетам..."
            onChange={handleSearchChange(onSearchChange)}
          />
        </label>
      </div>

      <div className={cn("no-drag", styles.actions)}>
        <button className={styles.secondaryButton} type="button" onClick={onAddTask}>
          <RedesignIcon name="add" className="size-[16px]" />
          <span className={styles.actionText}>Добавить</span>
        </button>
        <button className={styles.primaryButton} type="button" onClick={onRunAll}>
          <RedesignIcon name="play" className="size-[16px]" />
          <span className={styles.actionText}>Запустить всё</span>
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Уведомления"
          onClick={onOpenNotifications}
        >
          <RedesignIcon name="bell" />
          {visibleNotificationCount > 0 && (
            <span className={styles.notificationBadge}>{visibleNotificationCount > 9 ? "9+" : visibleNotificationCount}</span>
          )}
        </button>
        <button className={styles.iconButton} type="button" aria-label="Настройки" onClick={onOpenSettings}>
          <RedesignIcon name="settings" />
        </button>
        <div className={styles.windowDivider} aria-hidden />
        <button
          className={styles.windowButton}
          type="button"
          aria-label="Minimize"
          onClick={() => void currentWindow.minimize()}
        >
          <RedesignIcon name="minimize" className="size-[15px]" />
        </button>
        <button
          className={styles.windowButton}
          type="button"
          aria-label="Maximize"
          onClick={() => void currentWindow.toggleMaximize()}
        >
          <RedesignIcon name="stop" className="size-[13px]" />
        </button>
        <button
          className={cn(styles.windowButton, styles.closeWindowButton)}
          type="button"
          aria-label="Close"
          onClick={() => void currentWindow.close()}
        >
          <RedesignIcon name="close" className="size-[16px]" />
        </button>
      </div>
    </div>
  );
}

function handleSearchChange(onSearchChange: (value: string) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.currentTarget.value);
  };
}
