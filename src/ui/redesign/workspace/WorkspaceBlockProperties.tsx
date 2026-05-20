import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { getWorkspaceBlockDefinition } from "./workspaceBlockRegistry";
import styles from "./WorkspaceBuilderPage.module.css";
import type { WorkspacePanel } from "./workspaceTypes";

interface WorkspaceBlockPropertiesProps {
  panel: WorkspacePanel | null;
  onChange: (panel: WorkspacePanel) => void;
  onDelete: () => void;
}

export function WorkspaceBlockProperties({ panel, onChange, onDelete }: WorkspaceBlockPropertiesProps) {
  if (!panel) {
    return (
      <aside className={styles.properties}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Свойства</h2>
            <p>Выберите панель на canvas</p>
          </div>
        </div>
        <div className={styles.emptyPanel}>
          <RedesignIcon name="move" />
          <span>Кликните по панели, чтобы изменить позицию, размер, видимость и docking.</span>
        </div>
      </aside>
    );
  }

  const definition = getWorkspaceBlockDefinition(panel.type);
  const update = (patch: Partial<WorkspacePanel>) => onChange({ ...panel, ...patch });

  return (
    <aside className={styles.properties}>
      <div className={styles.panelHeader}>
        <div>
          <h2>Свойства панели</h2>
          <p>{definition.title}</p>
        </div>
      </div>

      <div className={styles.propertiesScroll}>
        <section className={styles.propertiesCard}>
          <div className={styles.selectedBlockTitle}>
            <span className={styles.libraryIcon}>
              <RedesignIcon name={definition.icon} />
            </span>
            <div>
              <strong>{panel.title}</strong>
              <span>{definition.description}</span>
            </div>
          </div>
        </section>

        <section className={styles.propertiesCard}>
          <label className={styles.field}>
            <span>Название</span>
            <Input value={panel.title} onChange={(event) => update({ title: event.target.value })} />
          </label>
          <label className={styles.switchRow}>
            <span>Показывать</span>
            <Switch checked={panel.visible} onCheckedChange={(visible) => update({ visible })} />
          </label>
          <label className={styles.switchRow}>
            <span>Заблокировать</span>
            <Switch checked={panel.locked} onCheckedChange={(locked) => update({ locked })} />
          </label>
          <label className={styles.switchRow}>
            <span>Docked panel</span>
            <Switch checked={panel.docked} onCheckedChange={(docked) => update({ docked })} />
          </label>
          <label className={styles.field}>
            <span>Tab group ID</span>
            <Input
              value={panel.tabGroupId ?? ""}
              placeholder="например: inspector-tabs"
              onChange={(event) => update({ tabGroupId: event.target.value.trim() || undefined })}
            />
          </label>
        </section>

        <section className={styles.propertiesCard}>
          <div className={styles.propertyGrid}>
            <NumberField label="X" value={panel.x} min={0} max={11} onChange={(x) => update({ x })} />
            <NumberField label="Y" value={panel.y} min={0} max={80} onChange={(y) => update({ y })} />
            <NumberField label="W" value={panel.w} min={panel.minW} max={panel.maxW ?? 12} onChange={(w) => update({ w })} />
            <NumberField label="H" value={panel.h} min={panel.minH} max={panel.maxH ?? 20} onChange={(h) => update({ h })} />
            <NumberField label="Min W" value={panel.minW} min={1} max={12} onChange={(minW) => update({ minW })} />
            <NumberField label="Min H" value={panel.minH} min={1} max={20} onChange={(minH) => update({ minH })} />
          </div>
        </section>

        <button type="button" className={styles.deleteButton} onClick={onDelete} disabled={!definition.removable}>
          <RedesignIcon name="trash" />
          Удалить панель
        </button>
      </div>
    </aside>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, normalized));
}
