import { Check, Link2 } from "lucide-react";

import { GraphitePanel } from "@/components/graphite-panel";
import { presetFeatureCatalog, type PresetFeatureId } from "@/stores/presets";

interface QueuePipelineProps {
  presetName: string;
  features: PresetFeatureId[];
}

export function QueuePipeline({ presetName, features }: QueuePipelineProps) {
  const steps = features
    .map((id) => presetFeatureCatalog.find((feature) => feature.id === id))
    .filter(Boolean);

  return (
    <GraphitePanel
      title={`Конвейер обработки (${presetName})`}
      className="shrink-0"
      bodyClassName="overflow-x-auto px-4 py-3"
    >
      <div className="flex min-w-max items-center gap-2">
        {steps.length === 0 ? (
          <div className="text-[12px] text-fg-tertiary">В пресете пока нет шагов обработки.</div>
        ) : (
          steps.map((step, index) => (
            <div key={step!.id} className="flex items-center gap-2">
              <div className="flex h-12 min-w-44 items-center gap-2 rounded border border-border-default bg-elevated/65 px-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent/18 font-mono text-[11px] font-semibold text-accent">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-fg-primary">
                    {step!.title}
                  </div>
                  <div className="truncate text-[10.5px] text-fg-tertiary">
                    {step!.description}
                  </div>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className="flex items-center gap-1 text-success/80">
                  <Check className="h-3.5 w-3.5" />
                  <Link2 className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </GraphitePanel>
  );
}
