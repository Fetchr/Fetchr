import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { LogLine } from "@/lib/ipc";

interface LogViewerProps {
  lines: LogLine[];
  autoScroll?: boolean;
  className?: string;
}

export function LogViewer({ lines, autoScroll = true, className }: LogViewerProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  return (
    <div
      ref={parentRef}
      className={cn(
        "h-full w-full overflow-auto rounded border border-border-default bg-canvas font-mono text-[11.5px] leading-[18px] text-fg-secondary",
        "min-h-0 overscroll-contain",
        className,
      )}
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index]!;
          const isErr = line.line.startsWith("!!");
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
              className={cn(
                "flex gap-3 whitespace-pre px-3 hover:bg-elevated/60",
                isErr && "text-danger",
              )}
            >
              <span className="shrink-0 text-fg-tertiary">
                {line.id.slice(0, 4)}
              </span>
              <span className="flex-1">{line.line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
