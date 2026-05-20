import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { RedesignIcon, type RedesignIconName } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./LeftNavigation.module.css";

export type LeftNavigationItemId =
  | "queue"
  | "logs"
  | "finder"
  | "chat-render"
  | "sponsor-blur"
  | "settings";

export interface LeftNavigationProps {
  activeItem: LeftNavigationItemId;
  onNavigate: (item: LeftNavigationItemId) => void;
  counters?: Partial<Record<LeftNavigationItemId, number>>;
  systemStatus?: ReactNode;
  licenseStatus?: ReactNode;
  className?: string;
}

const navigationItems: Array<{
  id: LeftNavigationItemId;
  label: string;
  icon: RedesignIconName;
}> = [
  { id: "queue", label: "Очередь", icon: "queue" },
  { id: "logs", label: "Логи", icon: "logs" },
  { id: "finder", label: "M3U8 Finder", icon: "finder" },
  { id: "chat-render", label: "Рендер чата", icon: "chat" },
  { id: "sponsor-blur", label: "Блюр спонсоров", icon: "blur" },
  { id: "settings", label: "Настройки", icon: "settings" },
];

export function LeftNavigation({
  activeItem,
  onNavigate,
  counters,
  systemStatus,
  licenseStatus,
  className,
}: LeftNavigationProps) {
  return (
    <aside className={cn(fetchrThemeClassName, styles.sidebar, className)} aria-label="Навигация Fetchr">
      <nav className={styles.nav}>
        {navigationItems.map((item) => {
          const active = item.id === activeItem;
          const counter = counters?.[item.id] ?? 0;

          return (
            <button
              className={cn(styles.navItem, active && styles.navItemActive)}
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <RedesignIcon name={item.icon} className={styles.navIcon} />
              <span className={styles.navLabel}>{item.label}</span>
              {counter > 0 && <span className={styles.badge}>{counter > 99 ? "99+" : counter}</span>}
            </button>
          );
        })}
      </nav>

      <div className={styles.spacer} />

      {(systemStatus || licenseStatus) && (
        <div className={styles.footer}>
          {systemStatus}
          {licenseStatus}
        </div>
      )}
    </aside>
  );
}
