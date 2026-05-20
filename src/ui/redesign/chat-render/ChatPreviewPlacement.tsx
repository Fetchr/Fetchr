import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";

export interface ChatPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
}

interface ChatPreviewPlacementProps {
  placement: ChatPlacement;
  frameUrl?: string | null;
  preserveRatio: boolean;
  constrainToBounds?: boolean;
  onPlacementChange: (placement: ChatPlacement) => void;
}

type DragState =
  | {
      mode: "move";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPlacement: ChatPlacement;
    }
  | {
      mode: "resize";
      handle: ResizeHandle;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPlacement: ChatPlacement;
    };

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_CHAT_WIDTH = 120;
const MIN_CHAT_HEIGHT = 80;
const HANDLE_CONFIG: Array<{ id: ResizeHandle; className: string; label: string }> = [
  { id: "n", className: styles.resizeN, label: "Изменить высоту сверху" },
  { id: "s", className: styles.resizeS, label: "Изменить высоту снизу" },
  { id: "e", className: styles.resizeE, label: "Изменить ширину справа" },
  { id: "w", className: styles.resizeW, label: "Изменить ширину слева" },
  { id: "ne", className: styles.resizeNE, label: "Изменить размер сверху справа" },
  { id: "nw", className: styles.resizeNW, label: "Изменить размер сверху слева" },
  { id: "se", className: styles.resizeSE, label: "Изменить размер снизу справа" },
  { id: "sw", className: styles.resizeSW, label: "Изменить размер снизу слева" },
];

const SAMPLE_MESSAGES = [
  ["viewer_01", "hello chat", "#7dd3fc"],
  ["mod_user", "Pog", "#f9a8d4"],
  ["streamfan", "nice moment", "#86efac"],
  ["someone", "LUL", "#fcd34d"],
];

export function ChatPreviewPlacement({
  placement,
  frameUrl,
  preserveRatio,
  constrainToBounds = true,
  onPlacementChange,
}: ChatPreviewPlacementProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const left = (placement.x / placement.outputWidth) * 100;
  const top = (placement.y / placement.outputHeight) * 100;
  const width = (placement.width / placement.outputWidth) * 100;
  const height = (placement.height / placement.outputHeight) * 100;
  const guides = useMemo(() => alignmentGuides(placement), [placement]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const update = () => {
      const rect = frame.getBoundingClientRect();
      setDisplaySize({ width: rect.width, height: rect.height });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const commitPlacement = (next: ChatPlacement) => {
    onPlacementChange(normalizePlacement(next, constrainToBounds));
  };

  const startMove = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "move",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPlacement: placement,
    };
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "resize",
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPlacement: placement,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !frame) return;

    const rect = frame.getBoundingClientRect();
    const scaleX = placement.outputWidth / Math.max(1, rect.width);
    const scaleY = placement.outputHeight / Math.max(1, rect.height);
    const dx = Math.round((event.clientX - drag.startClientX) * scaleX);
    const dy = Math.round((event.clientY - drag.startClientY) * scaleY);

    if (drag.mode === "move") {
      commitPlacement({
        ...drag.startPlacement,
        x: drag.startPlacement.x + dx,
        y: drag.startPlacement.y + dy,
      });
      return;
    }

    commitPlacement(resizePlacement(drag.startPlacement, drag.handle, dx, dy, preserveRatio));
  };

  const stopPointerAction = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
  };

  return (
    <div className={styles.previewShell}>
      <div
        ref={frameRef}
        className={styles.previewFrame}
        style={{ aspectRatio: `${placement.outputWidth} / ${placement.outputHeight}` }}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointerAction}
        onPointerCancel={stopPointerAction}
      >
        {frameUrl ? (
          <img className={styles.frameImage} src={frameUrl} alt="" />
        ) : (
          <div className={styles.gridBackdrop} />
        )}
        {guides.vertical && <div className={`${styles.alignmentGuide} ${styles.alignmentGuideV}`} />}
        {guides.horizontal && <div className={`${styles.alignmentGuide} ${styles.alignmentGuideH}`} />}
        <div
          className={styles.chatBox}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${width}%`,
            height: `${height}%`,
          }}
          onPointerDown={startMove}
        >
          <div className={styles.chatBoxHeader}>
            <RedesignIcon name="move" className="size-[12px]" />
            <span>Chat</span>
          </div>
          {SAMPLE_MESSAGES.map(([name, text, color]) => (
            <div className={styles.chatMessage} key={name}>
              <span style={{ color, fontWeight: 760 }}>{name}: </span>
              <span>{text}</span>
            </div>
          ))}
          {HANDLE_CONFIG.map((handle) => (
            <button
              key={handle.id}
              type="button"
              aria-label={handle.label}
              className={`${styles.resizeHandle} ${handle.className}`}
              onPointerDown={(event) => startResize(event, handle.id)}
            />
          ))}
        </div>
      </div>
      <div className={styles.previewMeta}>
        <span>{placement.outputWidth}x{placement.outputHeight}</span>
        <span>{Math.round(displaySize.width)}x{Math.round(displaySize.height)} preview</span>
        <span>
          x {placement.x} / y {placement.y} / {placement.width}x{placement.height}
        </span>
      </div>
    </div>
  );
}

function resizePlacement(
  start: ChatPlacement,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  preserveRatio: boolean,
): ChatPlacement {
  const leftLocked = start.x + start.width;
  const topLocked = start.y + start.height;
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle.includes("e")) width = start.width + dx;
  if (handle.includes("s")) height = start.height + dy;
  if (handle.includes("w")) {
    x = start.x + dx;
    width = start.width - dx;
  }
  if (handle.includes("n")) {
    y = start.y + dy;
    height = start.height - dy;
  }

  width = Math.max(MIN_CHAT_WIDTH, width);
  height = Math.max(MIN_CHAT_HEIGHT, height);

  if (preserveRatio) {
    const ratio = start.width / Math.max(1, start.height);
    const horizontal = handle.includes("e") || handle.includes("w");
    const vertical = handle.includes("n") || handle.includes("s");
    const preferWidth = horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy));

    if (preferWidth) {
      height = Math.max(MIN_CHAT_HEIGHT, Math.round(width / ratio));
    } else {
      width = Math.max(MIN_CHAT_WIDTH, Math.round(height * ratio));
    }
  }

  if (handle.includes("w")) x = leftLocked - width;
  if (handle.includes("n")) y = topLocked - height;

  return { ...start, x, y, width, height };
}

function normalizePlacement(placement: ChatPlacement, constrainToBounds: boolean): ChatPlacement {
  let width = Math.min(placement.outputWidth, Math.max(MIN_CHAT_WIDTH, Math.round(placement.width)));
  let height = Math.min(placement.outputHeight, Math.max(MIN_CHAT_HEIGHT, Math.round(placement.height)));
  let x = Math.round(placement.x);
  let y = Math.round(placement.y);

  if (constrainToBounds) {
    x = clamp(x, 0, placement.outputWidth - width);
    y = clamp(y, 0, placement.outputHeight - height);
  }

  if (x < 0 && constrainToBounds) x = 0;
  if (y < 0 && constrainToBounds) y = 0;
  if (x + width > placement.outputWidth && constrainToBounds) width = placement.outputWidth - x;
  if (y + height > placement.outputHeight && constrainToBounds) height = placement.outputHeight - y;

  return { ...placement, x, y, width, height };
}

function alignmentGuides(placement: ChatPlacement) {
  return {
    vertical: Math.abs(placement.x + placement.width / 2 - placement.outputWidth / 2) <= 1,
    horizontal: Math.abs(placement.y + placement.height / 2 - placement.outputHeight / 2) <= 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
