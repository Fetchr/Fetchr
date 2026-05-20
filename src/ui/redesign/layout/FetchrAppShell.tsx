import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./FetchrAppShell.module.css";

export interface FetchrAppShellProps {
  topBar?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  bottomBar?: ReactNode;
  className?: string;
  mainClassName?: string;
  sidebarClassName?: string;
  rightPanelClassName?: string;
  topBarClassName?: string;
  bottomBarClassName?: string;
  contentClassName?: string;
  sidebarWidth?: number | string;
  rightPanelWidth?: number | string;
  topBarHeight?: number | string;
  bottomBarHeight?: number | string;
  mainPadding?: number | string;
}

export function FetchrAppShell({
  topBar,
  sidebar,
  children,
  rightPanel,
  bottomBar,
  className,
  mainClassName,
  sidebarClassName,
  rightPanelClassName,
  topBarClassName,
  bottomBarClassName,
  contentClassName,
  sidebarWidth,
  rightPanelWidth,
  topBarHeight,
  bottomBarHeight,
  mainPadding,
}: FetchrAppShellProps) {
  const hasTopBar = Boolean(topBar);
  const hasSidebar = Boolean(sidebar);
  const hasRightPanel = Boolean(rightPanel);
  const hasBottomBar = Boolean(bottomBar);
  const style = {
    "--fetchr-shell-sidebar-width": toCssLength(sidebarWidth),
    "--fetchr-shell-right-panel-width": toCssLength(rightPanelWidth),
    "--fetchr-shell-topbar-height": toCssLength(topBarHeight),
    "--fetchr-shell-bottom-bar-height": toCssLength(bottomBarHeight),
    "--fetchr-shell-main-padding": toCssLength(mainPadding),
  } as CSSProperties;

  return (
    <div className={cn(fetchrThemeClassName, styles.shell, className)} style={style}>
      <div
        className={cn(
          styles.frame,
          !hasTopBar && styles.noTopBar,
          !hasSidebar && styles.noSidebar,
          !hasRightPanel && styles.noRightPanel,
          !hasBottomBar && styles.noBottomBar,
        )}
      >
        {hasTopBar && <header className={cn(styles.topBar, styles.slot, topBarClassName)}>{topBar}</header>}
        {hasSidebar && <aside className={cn(styles.sidebar, styles.slot, sidebarClassName)}>{sidebar}</aside>}

        <main className={cn(styles.main, styles.slot, mainClassName)}>
          <div className={cn(styles.mainInner, contentClassName)}>{children}</div>
        </main>

        {hasRightPanel && (
          <aside className={cn(styles.rightPanel, styles.slot, rightPanelClassName)}>{rightPanel}</aside>
        )}
        {hasBottomBar && <footer className={cn(styles.bottomBar, styles.slot, bottomBarClassName)}>{bottomBar}</footer>}
      </div>
    </div>
  );
}

function toCssLength(value: number | string | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}
