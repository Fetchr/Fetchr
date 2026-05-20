import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

import { LocalImage } from "@/components/local-image";
import { cn } from "@/lib/utils";
import type { BlurZone, ImageFit } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./SponsorBlurPage.module.css";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const MIN_ZONE_SIZE = 24;

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

interface SponsorZoneOverlayProps {
  zones: BlurZone[];
  selectedId: string | null;
  showZones: boolean;
  showGrid: boolean;
  children?: ReactNode;
  getZoneName: (zone: BlurZone, index: number) => string;
  onSelectZone: (id: string) => void;
  onChangeZone: (id: string, patch: Partial<BlurZone>) => void;
}

const ZONE_COLORS = ["#8a48ff", "#42d94b", "#f3b33d", "#2d83ff", "#ff5f67", "#31d0c5"];

export function SponsorZoneOverlay({
  zones,
  selectedId,
  showZones,
  showGrid,
  children,
  getZoneName,
  onSelectZone,
  onChangeZone,
}: SponsorZoneOverlayProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const startDrag = (event: PointerEvent, zone: BlurZone, mode: DragMode) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectZone(zone.id);
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

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame || drag.pointerId !== event.pointerId) return;

    const scale = DESIGN_WIDTH / frame.getBoundingClientRect().width;
    const dx = Math.round((event.clientX - drag.startClientX) * scale);
    const dy = Math.round((event.clientY - drag.startClientY) * scale);

    if (drag.mode === "move") {
      onChangeZone(drag.zoneId, { x: drag.startX + dx, y: drag.startY + dy });
      return;
    }

    onChangeZone(drag.zoneId, {
      width: drag.startWidth + dx,
      height: drag.startHeight + dy,
    });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
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
    <div
      ref={frameRef}
      className={styles.previewFrame}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      {children}
      {showGrid && <div className={styles.gridOverlay} />}
      {showZones &&
        zones.map((zone, index) => {
          const color = ZONE_COLORS[index % ZONE_COLORS.length];
          return (
            <div
              key={zone.id}
              className={cn(
                styles.zone,
                selectedId === zone.id && styles.zoneSelected,
                !zone.enabled && styles.zoneHidden,
              )}
              style={{
                "--zone-color": color,
                left: `${(zone.x / DESIGN_WIDTH) * 100}%`,
                top: `${(zone.y / DESIGN_HEIGHT) * 100}%`,
                width: `${(zone.width / DESIGN_WIDTH) * 100}%`,
                height: `${(zone.height / DESIGN_HEIGHT) * 100}%`,
              } as CSSProperties}
              onPointerDown={(event) => startDrag(event, zone, "move")}
            >
              {zone.effect === "image_overlay" && zone.image_path ? (
                <LocalImage
                  path={zone.image_path}
                  className={cn(styles.zoneImage, imageFitClass(zone.image_fit))}
                  draggable={false}
                />
              ) : null}
              <div className={styles.zoneLabel}>
                <RedesignIcon name="move" className="size-3" />
                {getZoneName(zone, index)}
              </div>
              <button
                type="button"
                aria-label="Изменить размер зоны"
                className={styles.zoneResize}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  startDrag(event, zone, "resize");
                }}
              />
            </div>
          );
        })}
    </div>
  );
}

export function clampSponsorZone(zone: BlurZone): BlurZone {
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
    intensity: Math.max(1, Math.min(100, Number(zone.intensity) || 1)),
    image_fit: zone.image_fit ?? "contain",
  };
}

function imageFitClass(value: ImageFit | null | undefined) {
  if (value === "cover") return styles.fitCover;
  if (value === "stretch") return styles.fitStretch;
  return styles.fitContain;
}
