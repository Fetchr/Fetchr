import { CopyPlus, MoreHorizontal, PanelRightClose, PanelRightOpen, Play, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { presetFeatureCatalog, usePresets } from "@/stores/presets";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

export function ActivePresetPanel() {
  const collapsed = useUI((s) => s.presetPanelCollapsed);
  const togglePanel = useUI((s) => s.togglePresetPanel);
  const presets = usePresets((s) => s.presets);
  const activePresetId = usePresets((s) => s.activePresetId);
  const updatePreset = usePresets((s) => s.updatePreset);
  const duplicatePreset = usePresets((s) => s.duplicatePreset);
  const clearPreset = usePresets((s) => s.clearPreset);
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const steps = activePreset.features
    .map((id) => presetFeatureCatalog.find((feature) => feature.id === id))
    .filter(Boolean);

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 border-l border-border-default bg-[#0d1218]/98 transition-[width,opacity] duration-200 xl:flex",
        collapsed ? "w-11 opacity-90" : "w-80 opacity-100",
      )}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={togglePanel}
          className="flex h-full w-full items-start justify-center pt-5 text-fg-tertiary hover:text-fg-primary"
          aria-label="Открыть текущий пресет"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 px-5 py-5">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase text-fg-tertiary">
                Текущий пресет
              </div>
              <div className="mt-1 truncate text-[18px] font-semibold text-accent">
                {activePreset.name}
              </div>
            </div>
            <button
              type="button"
              onClick={togglePanel}
              className="rounded-md p-2 text-fg-tertiary hover:bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:shadow-focus-ring"
              aria-label="Свернуть панель пресета"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>

          <div className="mx-5 grid grid-cols-2 rounded-lg border border-border-default bg-canvas/60 p-1">
            <button className="h-8 rounded-md bg-accent/18 text-[12px] font-medium text-accent">
              Свойства
            </button>
            <button className="h-8 rounded-md text-[12px] text-fg-tertiary hover:bg-elevated">
              Шаблон
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            <section className="rounded-lg border border-border-default bg-surface/85 p-3">
              <label className="grid gap-1.5">
                <span className="text-[11px] text-fg-tertiary">Название</span>
                <Input
                  value={activePreset.name}
                  onChange={(event) => updatePreset(activePreset.id, { name: event.target.value })}
                  className="h-8"
                />
              </label>
            </section>

            <section className="mt-3 rounded-lg border border-border-default bg-surface/85 p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[12px] font-semibold text-fg-primary">
                  Обработка ({steps.length} шагов)
                </h2>
                <Button size="icon-sm" variant="ghost">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {steps.length === 0 ? (
                  <div className="rounded border border-dashed border-border-default px-3 py-3 text-[11.5px] leading-4 text-fg-tertiary">
                    Добавьте действия через настройки пресета.
                  </div>
                ) : (
                  steps.map((step, index) => (
                    <div key={step!.id} className="flex items-start gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/20 font-mono text-[11px] font-semibold text-accent">
                        {index + 1}
                      </span>
                      <div className="min-w-0 pb-2">
                        <div className="truncate text-[12px] font-semibold text-fg-primary">
                          {step!.title}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-fg-tertiary">
                          {step!.description}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-2 border-t border-border-default p-5">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => duplicatePreset(activePreset.id)}>
                <CopyPlus className="h-3.5 w-3.5" />
                Дублировать
              </Button>
              <Button variant="secondary" size="sm" onClick={() => clearPreset(activePreset.id)}>
                <Trash2 className="h-3.5 w-3.5" />
                Очистить
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm">
                <Save className="h-3.5 w-3.5" />
                Сохранить
              </Button>
              <Button variant="primary" size="sm" onClick={() => ipc.startQueue(maxConcurrentJobs)}>
                <Play className="h-3.5 w-3.5" />
                Запустить
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
