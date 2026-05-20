import { Check, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  presetFeatureCatalog,
  type PresetFeatureId,
  usePresets,
} from "@/stores/presets";

export function PresetInlineAction({
  featureId,
  label,
  required = false,
  disabled = false,
  className,
}: {
  featureId: PresetFeatureId;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const presets = usePresets((s) => s.presets);
  const activePresetId = usePresets((s) => s.activePresetId);
  const toggleFeature = usePresets((s) => s.toggleFeature);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
  const feature = presetFeatureCatalog.find((item) => item.id === featureId);
  const added = activePreset.features.includes(featureId);
  const title = label ?? feature?.title ?? featureId;

  return (
    <button
      type="button"
      aria-label={
        added
          ? `Убрать "${title}" из пресета ${activePreset.name}`
          : `Добавить "${title}" в пресет ${activePreset.name}`
      }
      disabled={disabled || required}
      onClick={() => toggleFeature(activePreset.id, featureId)}
      className={cn(
        "group inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded border px-2 text-[11.5px] font-medium transition-all focus-visible:outline-none focus-visible:shadow-focus-ring",
        added
          ? "border-accent/45 bg-accent/15 text-[#85B7EB] shadow-[0_0_18px_rgba(55,138,221,0.12)]"
          : "border-border-default bg-elevated/70 text-fg-tertiary hover:border-accent/40 hover:bg-accent/10 hover:text-fg-primary",
        required && "border-warning/40 bg-warning/10 text-warning",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {required ? (
        <Check className="h-3.5 w-3.5" />
      ) : added ? (
        <>
          <Check className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">В пресете</span>
          <X className="hidden h-3 w-3 opacity-0 transition-opacity group-hover:inline group-hover:opacity-80" />
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">в пресет</span>
        </>
      )}
    </button>
  );
}
