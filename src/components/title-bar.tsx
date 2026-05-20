import {
  Bell,
  ChevronDown,
  Minus,
  Plus,
  Play,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Link } from "@tanstack/react-router";

import { BrandLogo } from "@/components/brand-logo";
import { Kbd } from "@/components/kbd";
import { NewsMenu } from "@/components/news-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { usePresets } from "@/stores/presets";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

function winBtn(hover: string) {
  return cn(
    "no-drag inline-flex h-full w-10 items-center justify-center text-fg-tertiary",
    "transition-colors hover:text-fg-primary",
    hover,
  );
}

export function TitleBar() {
  const w = getCurrentWindow();
  const presets = usePresets((s) => s.presets);
  const activePresetId = usePresets((s) => s.activePresetId);
  const setActivePreset = usePresets((s) => s.setActivePreset);
  const createPreset = usePresets((s) => s.createPreset);
  const toggleNews = useUI((s) => s.toggleNews);
  const openPalette = useUI((s) => s.openPalette);
  const openAdd = useUI((s) => s.openAddDialog);
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);

  return (
    <div className="drag-region relative flex h-14 shrink-0 items-center justify-between border-b border-border-default bg-[#10151c]/98">
      <div className="flex h-full min-w-0 items-center gap-3 pl-4">
        <div className="flex items-center gap-2">
          <BrandLogo />
          <span className="text-[15px] font-semibold text-fg-primary">Fetchr</span>
          <span className="font-mono text-[10px] text-fg-tertiary">v0.2.0</span>
        </div>

        <div className="no-drag ml-4 hidden h-8 items-center rounded-lg border border-border-default bg-canvas/75 p-0.5 xl:flex">
          <Link
            to="/presets"
            className="inline-flex h-7 items-center rounded-md px-3 text-[11.5px] text-fg-tertiary hover:text-fg-secondary"
          >
            Рабочее пространство
          </Link>
          {presets.slice(0, 4).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setActivePreset(preset.id)}
              className={cn(
                "h-7 rounded-md px-3 text-[11.5px] transition-colors",
                preset.id === activePresetId
                  ? "bg-accent/22 text-fg-primary"
                  : "text-fg-tertiary hover:bg-elevated hover:text-fg-secondary",
              )}
            >
              {preset.name}
            </button>
          ))}
          <button
            type="button"
            onClick={createPreset}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-[11.5px] text-fg-secondary hover:border-border-strong hover:bg-elevated"
          >
            <Plus className="h-3.5 w-3.5" />
            Новый пресет
          </button>
        </div>
      </div>

      <div className="no-drag hidden min-w-[320px] max-w-[520px] flex-1 px-5 lg:block">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border-default bg-canvas/78 px-3 text-left text-[12px] text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
        >
          <Search className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">Поиск по задачам, источникам, пресетам...</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>

      <div className="flex h-full items-center gap-2 pr-2">
        <div className="no-drag hidden items-center gap-2 md:flex">
          <Button variant="secondary" size="md" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" />
            Добавить
            <ChevronDown className="h-3.5 w-3.5 text-fg-tertiary" />
          </Button>
          <Button variant="primary" size="md" onClick={() => ipc.startQueue(maxConcurrentJobs)}>
            <Play className="h-3.5 w-3.5" />
            Запустить всё
          </Button>
        </div>
        <button
          type="button"
          className={cn(winBtn("hover:bg-elevated"), "relative w-9")}
          onClick={toggleNews}
          aria-label="Новости"
        >
          <Bell className="h-3.5 w-3.5" />
          <span className="absolute right-2 top-3 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        </button>
        <Link
          to="/settings"
          className="no-drag inline-flex h-full w-9 items-center justify-center text-fg-tertiary transition-colors hover:bg-elevated hover:text-fg-primary"
          aria-label="Настройки"
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>
        <div className="h-6 w-px bg-border-default" />
        <button
          type="button"
          className={winBtn("hover:bg-elevated")}
          onClick={() => w.minimize()}
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={winBtn("hover:bg-elevated")}
          onClick={() => w.toggleMaximize()}
          aria-label="Maximize"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={winBtn("hover:bg-danger hover:text-white")}
          onClick={() => w.close()}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <NewsMenu />
    </div>
  );
}
