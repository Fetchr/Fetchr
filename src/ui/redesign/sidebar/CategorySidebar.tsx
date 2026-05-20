import { cn } from "@/lib/utils";
import type { M3U8StreamerPreset } from "@/stores/workflowPresets";
import { RedesignIcon, type RedesignIconName } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./LeftNavigation.module.css";

export type CategorySidebarItemId =
  | "queue"
  | "finder"
  | "chat-render"
  | "sponsor-blur"
  | "logs"
  | "settings";

export interface CategorySidebarItem {
  id: CategorySidebarItemId;
  label: string;
  hint: string;
  icon: RedesignIconName;
  baseWorkspaceId: string;
  counter?: number;
}

export interface CategorySidebarProps {
  activeItem: CategorySidebarItemId;
  items: CategorySidebarItem[];
  onNavigate: (itemId: CategorySidebarItemId) => void;
  onCreatePreset: (item: CategorySidebarItem) => void;
  m3u8Presets?: M3U8StreamerPreset[];
  activeM3u8PresetId?: string | null;
  onSelectM3u8Preset?: (presetId: string) => void;
  onRenameM3u8Preset?: (presetId: string, name: string) => void;
  className?: string;
}

export function CategorySidebar({
  activeItem,
  items,
  onNavigate,
  onCreatePreset,
  m3u8Presets = [],
  activeM3u8PresetId,
  onSelectM3u8Preset,
  onRenameM3u8Preset,
  className,
}: CategorySidebarProps) {
  return (
    <aside className={cn(fetchrThemeClassName, styles.categorySidebar, className)} aria-label="Категории Fetchr">
      <div className={styles.categoryHeader}>
        <span>Категории</span>
        <small>быстрые пресеты</small>
      </div>
      <nav className={styles.categoryNav}>
        {items.map((item) => {
          const active = item.id === activeItem;
          return (
            <div className={cn(styles.categoryItem, active && styles.categoryItemActive)} key={item.id}>
              <button
                className={styles.categoryMainButton}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <RedesignIcon name={item.icon} className={styles.categoryIcon} />
                <span className={styles.categoryText}>
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </span>
                {item.counter ? <span className={styles.badge}>{item.counter > 99 ? "99+" : item.counter}</span> : null}
              </button>

              {item.id === "finder" ? (
                <button
                  className={styles.categoryAddButton}
                  type="button"
                  title="Создать M3U8 пресет стримера"
                  aria-label="Создать M3U8 пресет стримера"
                  onClick={() => onCreatePreset(item)}
                >
                  <RedesignIcon name="add" />
                </button>
              ) : (
                <span className={styles.categoryAddPlaceholder} aria-hidden />
              )}

              {item.id === "finder" && m3u8Presets.length > 0 ? (
                <div className={styles.categoryPresetList}>
                  {m3u8Presets.map((preset) => (
                    <button
                      className={cn(styles.categoryPresetButton, preset.id === activeM3u8PresetId && styles.categoryPresetButtonActive)}
                      key={preset.id}
                      type="button"
                      title={preset.streamer ? `Стример: ${preset.streamer}` : "Стример не указан"}
                      onClick={() => onSelectM3u8Preset?.(preset.id)}
                      onDoubleClick={() => {
                        const name = window.prompt("Новое имя M3U8 пресета", preset.name)?.trim();
                        if (name) onRenameM3u8Preset?.(preset.id, name);
                      }}
                    >
                      <span>{preset.name}</span>
                      <small>{preset.streamer || "укажите стримера"}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
