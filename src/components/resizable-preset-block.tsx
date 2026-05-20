import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PresetFeatureId } from "@/stores/presets";
import { PresetInlineAction } from "@/components/preset-inline-action";

type BlockMode = "compact" | "normal" | "expanded";

export function ResizablePresetBlock({
  featureId,
  title,
  icon: Icon,
  children,
  className,
  defaultSize = { width: 560, height: 260 },
  minWidth = 280,
  minHeight = 140,
}: {
  featureId: PresetFeatureId;
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  defaultSize?: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<BlockMode>("normal");
  const [size, setSize] = useState(() => {
    const raw = localStorage.getItem(`fetchr-block-size:${featureId}`);
    if (!raw) return defaultSize;
    try {
      return { ...defaultSize, ...JSON.parse(raw) };
    } catch {
      return defaultSize;
    }
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      const nextMode = rect.width < 420 ? "compact" : rect.width > 720 || rect.height > 420 ? "expanded" : "normal";
      setMode(nextMode);
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      localStorage.setItem(`fetchr-block-size:${featureId}`, JSON.stringify(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [featureId]);

  return (
    <section
      ref={ref}
      data-block-mode={mode}
      className={cn(
        "group flex min-w-0 flex-col overflow-auto rounded-lg border border-border-default bg-elevated/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors",
        "resize hover:border-border-strong data-[block-mode=compact]:p-3",
        className,
      )}
      style={{
        minWidth,
        minHeight,
        width: "min(100%, var(--fetchr-block-width))",
        height: "auto",
        ["--fetchr-block-width" as string]: `${size.width}px`,
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" />}
          <h2 className="truncate text-[13px] font-semibold text-fg-primary">{title}</h2>
        </div>
        <PresetInlineAction featureId={featureId} />
      </div>
      <div className="min-w-0 transition-[opacity,margin] duration-150 group-data-[block-mode=compact]:text-[12px]">
        {children}
      </div>
    </section>
  );
}
