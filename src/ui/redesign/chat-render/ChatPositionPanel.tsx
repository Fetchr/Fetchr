import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";
import { ChatPreviewPlacement, type ChatPlacement } from "./ChatPreviewPlacement";

interface ChatPositionPanelProps {
  placement: ChatPlacement;
  preserveRatio: boolean;
  frameUrl?: string | null;
  onPlacementChange: (placement: ChatPlacement) => void;
  onPreserveRatioChange: (value: boolean) => void;
}

export function ChatPositionPanel({
  placement,
  preserveRatio,
  frameUrl,
  onPlacementChange,
  onPreserveRatioChange,
}: ChatPositionPanelProps) {
  const patch = (patchValue: Partial<ChatPlacement>) => {
    const next = { ...placement, ...patchValue };
    if (preserveRatio && patchValue.width != null && patchValue.height == null) {
      const ratio = placement.height / Math.max(1, placement.width);
      next.height = Math.max(80, Math.round(next.width * ratio));
    }
    if (preserveRatio && patchValue.height != null && patchValue.width == null) {
      const ratio = placement.width / Math.max(1, placement.height);
      next.width = Math.max(120, Math.round(next.height * ratio));
    }
    onPlacementChange(normalizePlacement(next));
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>Предпросмотр и размещение</div>
        <RedesignIcon name="move" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <ChatPreviewPlacement
            placement={placement}
            frameUrl={frameUrl}
            preserveRatio={preserveRatio}
            onPlacementChange={onPlacementChange}
          />
          <div className={styles.fourColumn}>
            <NumberField label="X" value={placement.x} onChange={(x) => patch({ x })} />
            <NumberField label="Y" value={placement.y} onChange={(y) => patch({ y })} />
            <NumberField label="Ширина" value={placement.width} onChange={(width) => patch({ width })} />
            <NumberField label="Высота" value={placement.height} onChange={(height) => patch({ height })} />
          </div>
          <label className={styles.toggleRow}>
            <span>Сохранять пропорции</span>
            <input type="checkbox" checked={preserveRatio} onChange={(event) => onPreserveRatioChange(event.target.checked)} />
          </label>
        </div>
      </div>
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={`${styles.input} ${styles.mono}`}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePlacement(placement: ChatPlacement): ChatPlacement {
  const width = clamp(Math.round(placement.width), 120, placement.outputWidth);
  const height = clamp(Math.round(placement.height), 80, placement.outputHeight);
  return {
    ...placement,
    x: clamp(Math.round(placement.x), 0, placement.outputWidth - width),
    y: clamp(Math.round(placement.y), 0, placement.outputHeight - height),
    width,
    height,
  };
}
