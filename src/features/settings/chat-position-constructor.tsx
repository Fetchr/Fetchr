import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Move, Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatOverlaySettings } from "@/types/job";
import { cn } from "@/lib/utils";

interface ChatPositionConstructorProps {
  value: ChatOverlaySettings;
  onSave: (value: ChatOverlaySettings) => void;
}

type DragMode = "move" | "resize";

interface DragState {
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const MIN_CHAT_WIDTH = 120;
const MIN_CHAT_HEIGHT = 120;
const SNAP_DISTANCE = 20;
export function ChatPositionConstructor({
  value,
  onSave,
}: ChatPositionConstructorProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<ChatOverlaySettings>(() => ({
    ...value,
    output_width: value.output_width ?? DESIGN_WIDTH,
    output_height: value.output_height ?? DESIGN_HEIGHT,
    chat_x: value.chat_x ?? 80,
    chat_y: value.chat_y ?? 760,
    chat_width: value.chat_width ?? 1760,
    chat_height: value.chat_height ?? 260,
  }));

  const box = useMemo(
    () => clampBox({
      x: draft.chat_x ?? 80,
      y: draft.chat_y ?? 760,
      width: draft.chat_width ?? 1760,
      height: draft.chat_height ?? 260,
    }),
    [draft.chat_height, draft.chat_width, draft.chat_x, draft.chat_y],
  );

  const guides = useMemo(() => alignmentGuides(box), [box]);

  const updateBox = (patch: Partial<typeof box>, snap = false) => {
    const raw = { ...box, ...patch };
    const next = clampBox(snap ? snapBox(raw) : raw);
    setDraft((current) => ({
      ...current,
      output_width: DESIGN_WIDTH,
      output_height: DESIGN_HEIGHT,
      chat_x: next.x,
      chat_y: next.y,
      chat_width: next.width,
      chat_height: next.height,
    }));
  };
  const startDrag = (event: PointerEvent, mode: DragMode) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: box.x,
      startY: box.y,
      startWidth: box.width,
      startHeight: box.height,
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame || drag.pointerId !== event.pointerId) return;

    const scale = DESIGN_WIDTH / frame.getBoundingClientRect().width;
    const dx = Math.round((event.clientX - drag.startClientX) * scale);
    const dy = Math.round((event.clientY - drag.startClientY) * scale);

    if (drag.mode === "move") {
      updateBox({ x: drag.startX + dx, y: drag.startY + dy }, true);
    } else {
      updateBox({
        width: drag.startWidth + dx,
        height: drag.startHeight + dy,
      });
    }
  };

  const stopDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture may already be released */
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frameRef}
        className="relative aspect-video w-full overflow-hidden rounded border border-border-default bg-black"
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:5%_8.888%]" />
        <div className="absolute inset-x-0 top-0 flex h-8 items-center justify-between bg-black/45 px-3 text-[11px] text-white/75">
          <span className="font-mono">1920x1080</span>
          <span className="font-mono">
            x {box.x} / y {box.y} / {box.width}x{box.height}
          </span>
        </div>
        {guides.vertical && (
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />
        )}
        {guides.horizontal && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent/80" />
        )}
        <div
          className={cn(
            "absolute cursor-move border border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(0,0,0,0.65)]",
            "touch-none select-none",
          )}
          style={{
            left: `${(box.x / DESIGN_WIDTH) * 100}%`,
            top: `${(box.y / DESIGN_HEIGHT) * 100}%`,
            width: `${(box.width / DESIGN_WIDTH) * 100}%`,
            height: `${(box.height / DESIGN_HEIGHT) * 100}%`,
          }}
          onPointerDown={(event) => startDrag(event, "move")}
        >
          <div className="flex h-full flex-col justify-end gap-1 p-2 text-[10px] text-white">
            {[
              ["viewer_01", "hello chat"],
              ["mod_user", "Pog"],
              ["streamfan", "nice moment"],
              ["someone", "LUL"],
            ].map(([name, text]) => (
              <div key={name} className="drop-shadow-[0_1px_1px_black]">
                <span className="font-semibold text-sky-300">{name}: </span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">
            <Move className="h-3 w-3" />
            Chat
          </div>
          <button
            type="button"
            aria-label="Resize chat"
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-l border-t border-accent bg-accent"
            onPointerDown={(event) => {
              event.stopPropagation();
              startDrag(event, "resize");
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <PositionField label="X" value={box.x} onChange={(x) => updateBox({ x })} />
        <PositionField label="Y" value={box.y} onChange={(y) => updateBox({ y })} />
        <PositionField
          label={t("settings.chat_overlay_width", { defaultValue: "Width" })}
          value={box.width}
          onChange={(width) => updateBox({ width })}
        />
        <PositionField
          label={t("settings.chat_overlay_height", { defaultValue: "Height" })}
          value={box.height}
          onChange={(height) => updateBox({ height })}
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          onClick={() => onSave(boxToSettings(box))}
        >
          <Save className="h-3.5 w-3.5" />
          {t("settings.chat_overlay_save_position")}
        </Button>
      </div>
    </div>
  );
}

function PositionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-fg-tertiary">{label}</span>
      <Input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="font-mono text-[12px]"
      />
    </label>
  );
}

function boxToSettings(box: ReturnType<typeof clampBox>): ChatOverlaySettings {
  return {
    output_width: DESIGN_WIDTH,
    output_height: DESIGN_HEIGHT,
    chat_x: box.x,
    chat_y: box.y,
    chat_width: box.width,
    chat_height: box.height,
  };
}

function clampBox(box: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(DESIGN_WIDTH, Math.max(MIN_CHAT_WIDTH, Math.round(box.width)));
  const height = Math.min(DESIGN_HEIGHT, Math.max(MIN_CHAT_HEIGHT, Math.round(box.height)));
  const x = Math.min(DESIGN_WIDTH - width, Math.max(0, Math.round(box.x)));
  const y = Math.min(DESIGN_HEIGHT - height, Math.max(0, Math.round(box.y)));
  return { x, y, width, height };
}

function snapBox(box: { x: number; y: number; width: number; height: number }) {
  const centerX = Math.round((DESIGN_WIDTH - box.width) / 2);
  const centerY = Math.round((DESIGN_HEIGHT - box.height) / 2);
  return {
    ...box,
    x: snapTo(box.x, [0, centerX, DESIGN_WIDTH - box.width]),
    y: snapTo(box.y, [0, centerY, DESIGN_HEIGHT - box.height]),
  };
}

function snapTo(value: number, targets: number[]) {
  for (const target of targets) {
    if (Math.abs(value - target) <= SNAP_DISTANCE) return target;
  }
  return value;
}

function alignmentGuides(box: { x: number; y: number; width: number; height: number }) {
  return {
    vertical: Math.abs(box.x + box.width / 2 - DESIGN_WIDTH / 2) <= 1,
    horizontal: Math.abs(box.y + box.height / 2 - DESIGN_HEIGHT / 2) <= 1,
  };
}
