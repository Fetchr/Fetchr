import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Image as ImageIcon, Move, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LocalImage } from "@/components/local-image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { BlurEffect, BlurZone } from "@/types/job";

interface BlurZoneConstructorProps {
  value: BlurZone[];
  onSave: (value: BlurZone[]) => void;
  referenceImageSrc?: string | null;
}

type DragMode = "move" | "resize";

interface DragState {
  mode: DragMode;
  pointerId: number;
  zoneId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const MIN_ZONE_SIZE = 24;

export function BlurZoneConstructor({ value, onSave, referenceImageSrc }: BlurZoneConstructorProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<BlurZone[]>(() => value.map(clampZone));
  const [selectedId, setSelectedId] = useState<string | null>(() => draft[0]?.id ?? null);

  const selected = useMemo(
    () => draft.find((zone) => zone.id === selectedId) ?? draft[0] ?? null,
    [draft, selectedId],
  );

  const updateZone = (id: string, patch: Partial<BlurZone>) => {
    setDraft((zones) =>
      zones.map((zone) => (zone.id === id ? clampZone({ ...zone, ...patch }) : zone)),
    );
  };

  const addZone = () => {
    const zone = clampZone({
      id: crypto.randomUUID?.() ?? String(Date.now()),
      enabled: true,
      x: 120,
      y: 120,
      width: 420,
      height: 140,
      effect: "mosaic",
      intensity: 12,
      image_path: null,
      image_fit: "contain",
    });
    setDraft((zones) => [...zones, zone]);
    setSelectedId(zone.id);
  };

  const removeZone = (id: string) => {
    setDraft((zones) => zones.filter((zone) => zone.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const chooseImage = async (id: string) => {
    const path = await ipc.chooseImageFile();
    if (path) updateZone(id, { image_path: path, effect: "image_overlay" });
  };

  const startDrag = (event: PointerEvent, zone: BlurZone, mode: DragMode) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(zone.id);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      zoneId: zone.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: zone.x,
      startY: zone.y,
      startWidth: zone.width,
      startHeight: zone.height,
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
      updateZone(drag.zoneId, { x: drag.startX + dx, y: drag.startY + dy });
    } else {
      updateZone(drag.zoneId, {
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
        {referenceImageSrc ? (
          <LocalImage
            path={referenceImageSrc}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:5%_8.888%]" />
        <div className="absolute inset-x-0 top-0 flex h-8 items-center justify-between bg-black/45 px-3 text-[11px] text-white/75">
          <span className="font-mono">1920x1080</span>
          <span className="font-mono">{draft.length} blur zones</span>
        </div>
        {draft.map((zone, index) => (
          <div
            key={zone.id}
            className={cn(
              "absolute cursor-move border shadow-[0_0_0_1px_rgba(0,0,0,0.65)]",
              "touch-none select-none",
              selected?.id === zone.id
                ? "border-warning bg-warning/20"
                : "border-accent bg-accent/15",
              !zone.enabled && "opacity-45",
            )}
            style={{
              left: `${(zone.x / DESIGN_WIDTH) * 100}%`,
              top: `${(zone.y / DESIGN_HEIGHT) * 100}%`,
              width: `${(zone.width / DESIGN_WIDTH) * 100}%`,
              height: `${(zone.height / DESIGN_HEIGHT) * 100}%`,
            }}
            onPointerDown={(event) => startDrag(event, zone, "move")}
          >
            {zone.effect === "image_overlay" && zone.image_path ? (
              <LocalImage
                path={zone.image_path}
                className={cn(
                  "h-full w-full opacity-90",
                  (zone.image_fit ?? "contain") === "cover" && "object-cover",
                  (zone.image_fit ?? "contain") === "contain" && "object-contain",
                  (zone.image_fit ?? "contain") === "stretch" && "object-fill",
                )}
                draggable={false}
              />
            ) : null}
            <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">
              <Move className="h-3 w-3" />
              Zone {index + 1}
            </div>
            <button
              type="button"
              aria-label="Resize blur zone"
              className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-l border-t border-warning bg-warning"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, zone, "resize");
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="md" onClick={addZone}>
          <Plus className="h-3.5 w-3.5" />
          Добавить зону
        </Button>
        <Button variant="primary" size="md" onClick={() => onSave(draft.map(clampZone))}>
          <Save className="h-3.5 w-3.5" />
          Сохранить зоны
        </Button>
      </div>

      {draft.length > 0 && (
        <div className="flex flex-col gap-2">
          {draft.map((zone, index) => (
            <div
              key={zone.id}
              className={cn(
                "grid grid-cols-[28px_1fr_1fr_1fr_1fr_96px_96px_36px] items-end gap-2 rounded border border-border-subtle bg-surface p-2",
                selected?.id === zone.id && "border-accent",
              )}
              onClick={() => setSelectedId(zone.id)}
            >
              <Switch
                checked={zone.enabled}
                onCheckedChange={(enabled) => updateZone(zone.id, { enabled })}
              />
              <PositionField label="X" value={zone.x} onChange={(x) => updateZone(zone.id, { x })} />
              <PositionField label="Y" value={zone.y} onChange={(y) => updateZone(zone.id, { y })} />
              <PositionField label="W" value={zone.width} onChange={(width) => updateZone(zone.id, { width })} />
              <PositionField label="H" value={zone.height} onChange={(height) => updateZone(zone.id, { height })} />
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-fg-tertiary">Эффект</span>
                <Select
                  value={zone.effect}
                  onValueChange={(effect) => updateZone(zone.id, { effect: effect as BlurEffect })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mosaic">Mosaic</SelectItem>
                    <SelectItem value="gaussian_blur">Blur</SelectItem>
                    <SelectItem value="image_overlay">Image</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <PositionField
                label="Сила"
                value={zone.intensity}
                onChange={(intensity) => updateZone(zone.id, { intensity })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Удалить зону ${index + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeZone(zone.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {zone.effect === "image_overlay" && (
                <div className="col-span-8 flex items-center gap-2">
                  <Input
                    value={zone.image_path ?? ""}
                    onChange={(event) => updateZone(zone.id, { image_path: event.target.value })}
                    placeholder="Путь к картинке"
                    className="font-mono text-[12px]"
                  />
                  <Button variant="secondary" size="md" onClick={() => chooseImage(zone.id)}>
                    <ImageIcon className="h-3.5 w-3.5" />
                    Файл
                  </Button>
                  <Select
                    value={zone.image_fit ?? "contain"}
                    onValueChange={(image_fit) => updateZone(zone.id, { image_fit: image_fit as never })}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contain">Contain</SelectItem>
                      <SelectItem value="cover">Cover</SelectItem>
                      <SelectItem value="stretch">Stretch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
      <span className="text-[10px] text-fg-tertiary">{label}</span>
      <Input
        type="number"
        value={Math.round(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="font-mono text-[12px]"
      />
    </label>
  );
}

function clampZone(zone: BlurZone): BlurZone {
  const width = Math.min(DESIGN_WIDTH, Math.max(MIN_ZONE_SIZE, Math.round(zone.width)));
  const height = Math.min(DESIGN_HEIGHT, Math.max(MIN_ZONE_SIZE, Math.round(zone.height)));
  const x = Math.min(DESIGN_WIDTH - width, Math.max(0, Math.round(zone.x)));
  const y = Math.min(DESIGN_HEIGHT - height, Math.max(0, Math.round(zone.y)));
  return {
    ...zone,
    x,
    y,
    width,
    height,
    intensity: Math.max(1, Number(zone.intensity) || 1),
    image_fit: zone.image_fit ?? "contain",
  };
}
