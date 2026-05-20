import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface GraphitePanelProps {
  title?: string;
  subtitle?: string;
  icon?: ElementType;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function GraphitePanel({
  title,
  subtitle,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: GraphitePanelProps) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle px-4">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />}
            <div className="min-w-0">
              {title && (
                <h2 className="truncate text-[12.5px] font-semibold text-fg-primary">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="truncate text-[10.5px] text-fg-tertiary">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}
