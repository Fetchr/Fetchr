import { useMemo, useRef, useState, type PointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Image as ImageIcon, Move, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { BlurEffect, BlurZone, ChatOverlaySettings, ImageFit } from "@/types/job";

interface OverlayPreviewConstructorProps {
  screenshotUrl: string;
  chatOverlay: ChatOverlaySettings;
  blurZones: BlurZone[];
  onSave: (chatOverlay: ChatOverlaySettings, blurZones: BlurZone[]) => void;
}

type Target = "chat" | `zone:${string}`;
type DragMode = "move" | "resize";

interface DragState {
  target: Target;
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
const MIN_ZONE_SIZE = 24;

export function OverlayPreviewConstructor({
  screenshotUrl,
  chatOverlay,
  blurZones,
  onSave,
}: OverlayPreviewConstructorProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [chatDraft, setChatDraft] = useState<ChatOverlaySettings>(() => ({
    ...chatOverlay,
    output_width: DESIGN_WIDTH,
    output_height: DESIGN_HEIGHT,
  }));
  const [zoneDraft, setZoneDraft] = useState<BlurZone[]>(() => blurZones.map(clampZone));
  const [selectedTarget, setSelectedTarget] = useState<Target>("chat");

  const chatBox = useMemo(
    () =>
      clampChatBox({
        x: chatDraft.chat_x ?? 1600,
        y: chatDraft.chat_y ?? 260,
        width: chatDraft.chat_width ?? 290,
        height: chatDraft.chat_height ?? 640,
      }),
    [chatDraft.chat_height, chatDraft.chat_width, chatDraft.chat_x, chatDraft.chat_y],
  );

  const updateChatBox = (patch: Partial<typeof chatBox>) => {
    const next = clampChatBox({ ...chatBox, ...patch });
    setChatDraft((current) => ({
      ...current,
      output_width: DESIGN_WIDTH,
      output_height: DESIGN_HEIGHT,
      chat_x: next.x,
      chat_y: next.y,
      chat_width: next.width,
      chat_height: next.height,
    }));
  };

  const updateZone = (id: string, patch: Partial<BlurZone>) => {
    setZoneDraft((zones) =>
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
    setZoneDraft((zones) => [...zones, zone]);
    setSelectedTarget(`zone:${zone.id}`);
  };

  const removeZone = (id: string) => {
    setZoneDraft((zones) => zones.filter((zone) => zone.id !== id));
    if (selectedTarget === `zone:${id}`) setSelectedTarget("chat");
  };

  const chooseImage = async (id: string) => {
    const path = await ipc.chooseImageFile();
    if (path) updateZone(id, { image_path: path, effect: "image_overlay", image_fit: "contain" });
  };

  const startDrag = (
    event: PointerEvent,
    target: Target,
    mode: DragMode,
    box: { x: number; y: number; width: number; height: number },
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedTarget(target);
    dragRef.current = {
      target,
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
    const patch =
      drag.mode === "move"
        ? { x: drag.startX + dx, y: drag.startY + dy }
        : { width: drag.startWidth + dx, height: drag.startHeight + dy };

    if (drag.target === "chat") {
      updateChatBox(patch);
    } else {
      updateZone(drag.target.slice("zone:".length), patch);
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
        <img src={screenshotUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
        {zoneDraft.map((zone, index) => (
          <div
            key={zone.id}
            className={cn(
              "absolute touch-none select-none overflow-hidden border shadow-[0_0_0_1px_rgba(0,0,0,0.7)]",
              selectedTarget === `zone:${zone.id}` ? "border-warning" : "border-accent",
              !zone.enabled && "opacity-45",
            )}
            style={boxStyle(zone)}
            onPointerDown={(event) => startDrag(event, `zone:${zone.id}`, "move", zone)}
          >
            <ZonePreview zone={zone} screenshotUrl={screenshotUrl} />
            <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
              <Move className="h-3 w-3" />
              Zone {index + 1}
            </div>
            <ResizeHandle onPointerDown={(event) => {
              event.stopPropagation();
              startDrag(event, `zone:${zone.id}`, "resize", zone);
            }} />
          </div>
        ))}
        <div
          className={cn(
            "absolute touch-none select-none border border-accent bg-black/10 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]",
            selectedTarget === "chat" && "border-white",
          )}
          style={boxStyle(chatBox)}
          onPointerDown={(event) => startDrag(event, "chat", "move", chatBox)}
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
          <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
            <Move className="h-3 w-3" />
            Chat
          </div>
          <ResizeHandle onPointerDown={(event) => {
            event.stopPropagation();
            startDrag(event, "chat", "resize", chatBox);
          }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="md" onClick={addZone}>
          <Plus className="h-3.5 w-3.5" />
          Добавить блюр-зону
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() =>
            onSave(
              {
                ...chatDraft,
                output_width: DESIGN_WIDTH,
                output_height: DESIGN_HEIGHT,
                chat_x: chatBox.x,
                chat_y: chatBox.y,
                chat_width: chatBox.width,
                chat_height: chatBox.height,
              },
              zoneDraft.map(clampZone),
            )
          }
        >
          <Save className="h-3.5 w-3.5" />
          Сохранить preview-разметку
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <PositionField label="Chat X" value={chatBox.x} onChange={(x) => updateChatBox({ x })} />
        <PositionField label="Chat Y" value={chatBox.y} onChange={(y) => updateChatBox({ y })} />
        <PositionField label="Chat W" value={chatBox.width} onChange={(width) => updateChatBox({ width })} />
        <PositionField label="Chat H" value={chatBox.height} onChange={(height) => updateChatBox({ height })} />
      </div>

      {zoneDraft.length > 0 && (
        <div className="flex flex-col gap-2">
          {zoneDraft.map((zone, index) => (
            <div
              key={zone.id}
              className={cn(
                "grid grid-cols-[28px_1fr_1fr_1fr_1fr_96px_88px_36px] items-end gap-2 rounded border border-border-subtle bg-surface p-2",
                selectedTarget === `zone:${zone.id}` && "border-accent",
              )}
              onClick={() => setSelectedTarget(`zone:${zone.id}`)}
            >
              <Switch checked={zone.enabled} onCheckedChange={(enabled) => updateZone(zone.id, { enabled })} />
              <PositionField label="X" value={zone.x} onChange={(x) => updateZone(zone.id, { x })} />
              <PositionField label="Y" value={zone.y} onChange={(y) => updateZone(zone.id, { y })} />
              <PositionField label="W" value={zone.width} onChange={(width) => updateZone(zone.id, { width })} />
              <PositionField label="H" value={zone.height} onChange={(height) => updateZone(zone.id, { height })} />
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-fg-tertiary">Эффект</span>
                <Select value={zone.effect} onValueChange={(effect) => updateZone(zone.id, { effect: effect as BlurEffect })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mosaic">Mosaic</SelectItem>
                    <SelectItem value="gaussian_blur">Blur</SelectItem>
                    <SelectItem value="image_overlay">Image</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <PositionField label="Сила" value={zone.intensity} onChange={(intensity) => updateZone(zone.id, { intensity })} />
              <Button variant="ghost" size="icon-sm" title={`Удалить зону ${index + 1}`} onClick={(event) => {
                event.stopPropagation();
                removeZone(zone.id);
              }}>
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
                  <Select value={zone.image_fit ?? "contain"} onValueChange={(image_fit) => updateZone(zone.id, { image_fit: image_fit as ImageFit })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
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

function ZonePreview({ zone, screenshotUrl }: { zone: BlurZone; screenshotUrl: string }) {
  if (zone.effect === "image_overlay" && zone.image_path) {
    return (
      <img
        src={pathToImageSrc(zone.image_path)}
        alt=""
        className={cn(
          "h-full w-full bg-black/40",
          (zone.image_fit ?? "contain") === "contain" && "object-contain",
          zone.image_fit === "cover" && "object-cover",
          zone.image_fit === "stretch" && "object-fill",
        )}
      />
    );
  }
  if (zone.effect === "gaussian_blur") {
    return (
      <img
        src={screenshotUrl}
        alt=""
        className="absolute opacity-90"
        style={{
          width: `${DESIGN_WIDTH / zone.width * 100}%`,
          height: `${DESIGN_HEIGHT / zone.height * 100}%`,
          left: `${-(zone.x / zone.width) * 100}%`,
          top: `${-(zone.y / zone.height) * 100}%`,
          filter: `blur(${Math.max(1, zone.intensity / 2)}px)`,
          transform: "scale(1.04)",
          transformOrigin: "center",
        }}
      />
    );
  }
  return (
    <div
      className="h-full w-full opacity-85"
      style={{
        backgroundImage: `url(${screenshotUrl})`,
        backgroundSize: `${DESIGN_WIDTH / Math.max(1, zone.width) * 100}% ${DESIGN_HEIGHT / Math.max(1, zone.height) * 100}%`,
        backgroundPosition: `${-(zone.x / Math.max(1, zone.width)) * 100}% ${-(zone.y / Math.max(1, zone.height)) * 100}%`,
        imageRendering: "pixelated",
        filter: `blur(${Math.max(0, zone.intensity / 24)}px)`,
      }}
    />
  );
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (event: PointerEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="Resize"
      className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-l border-t border-accent bg-accent"
      onPointerDown={onPointerDown}
    />
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

function boxStyle(box: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${(box.x / DESIGN_WIDTH) * 100}%`,
    top: `${(box.y / DESIGN_HEIGHT) * 100}%`,
    width: `${(box.width / DESIGN_WIDTH) * 100}%`,
    height: `${(box.height / DESIGN_HEIGHT) * 100}%`,
  };
}

function clampChatBox(box: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(DESIGN_WIDTH, Math.max(MIN_CHAT_WIDTH, Math.round(box.width)));
  const height = Math.min(DESIGN_HEIGHT, Math.max(MIN_CHAT_HEIGHT, Math.round(box.height)));
  const x = Math.min(DESIGN_WIDTH - width, Math.max(0, Math.round(box.x)));
  const y = Math.min(DESIGN_HEIGHT - height, Math.max(0, Math.round(box.y)));
  return { x, y, width, height };
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

function pathToImageSrc(path: string) {
  if (/^(data:|https?:)/i.test(path)) return path;
  return convertFileSrc(path.replace(/^file:\/+/i, ""));
}
