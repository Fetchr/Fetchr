import { useState } from "react";

import { RedesignIcon, PlatformIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./QueuePage.module.css";
import { TaskProgressBar } from "./TaskProgressBar";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskThumbnail } from "./TaskThumbnail";
import type { QueueTaskActions, QueueTaskUi } from "./taskUiTypes";

export interface TaskRowProps {
  task: QueueTaskUi;
  actions?: QueueTaskActions;
}

export function TaskRow({ task, actions }: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const canMove = task.status === "queued";
  const canCancel = task.status === "running" || task.status === "paused";
  const canRemove = task.status !== "running";

  return (
    <>
    <div className={`${styles.row} ${task.status === "running" ? styles.rowActive : ""}`}>
      <div className={styles.titleCell}>
        <TaskThumbnail
          thumbnailUrl={task.thumbnailUrl}
          title={task.title}
          platform={task.platform}
          durationLabel={null}
          live={task.live}
          chatOnly={task.chatOnly}
        />
        <div className={styles.taskText}>
          <div className={styles.taskTitle} title={task.title}>
            {task.title}
          </div>
          <div className={styles.taskSubtitle} title={task.subtitle}>
            {task.subtitle}
          </div>
        </div>
      </div>

      <div className={styles.sourceCell}>
        <div className={styles.sourceTop}>
          <PlatformIcon platform={task.platform} className="size-[14px]" />
          <span className={styles.subtleText}>{task.sourceLabel}</span>
        </div>
        <div className={styles.sourceUrl} title={task.sourceUrl}>
          {task.sourceUrl}
        </div>
      </div>

      <div className={styles.subtleText} title={task.presetName}>
        {task.presetName}
      </div>

      <div className={styles.statusCell}>
        <TaskStatusBadge status={task.status} label={task.statusLabel} />
        <div className={styles.statusDetail} title={task.error ?? task.statusDetail}>
          {task.error ?? task.statusDetail}
        </div>
      </div>

      <div className={styles.monoCell} title={task.speed}>
        {task.speed}
      </div>
      <div className={styles.monoCell} title={task.eta}>
        {task.eta}
      </div>
      <div className={styles.monoCell} title={task.size}>
        {task.size}
      </div>

      <TaskProgressBar
        value={task.progress}
        status={task.status}
        downloadedLabel={task.downloadedLabel}
        totalLabel={task.totalLabel}
        stageValue={task.stagePercent}
        stageLabel={task.progressMessage}
      />

      <div className={styles.subtleText} title={task.addedLabel}>
        {task.addedLabel}
      </div>

      <div className={styles.rowActions}>
        <RowAction label={expanded ? "Скрыть детали" : "Подробнее"} onClick={() => setExpanded((value) => !value)} icon="more" />
        {canMove && (
          <>
            <RowAction label="Выше" onClick={() => actions?.onMoveUp?.(task.id)} icon="move" />
            <RowAction label="Ниже" onClick={() => actions?.onMoveDown?.(task.id)} icon="move" />
          </>
        )}
        {canCancel && <RowAction label="Отменить" onClick={() => actions?.onCancel?.(task.id)} icon="close" />}
        {task.outputPath && (
          <RowAction label="Показать файл" onClick={() => actions?.onRevealFile?.(task.outputPath!)} icon="check" />
        )}
        <RowAction label="Открыть папку" onClick={() => actions?.onOpenFolder?.(task.directory)} icon="folder" />
        {canRemove && <RowAction label="Удалить" onClick={() => actions?.onRemove?.(task.id)} icon="trash" />}
      </div>
    </div>
    {expanded && (
      <div className={styles.detailsRow}>
        <Detail label="Общий прогресс" value={`${Math.round(task.progress)}%`} />
        <Detail label="Стадия" value={task.progressMessage ?? task.statusDetail ?? "—"} wide />
        <Detail label="Прогресс стадии" value={task.stagePercent != null ? `${task.stagePercent.toFixed(1)}%` : "—"} />
        <Detail label="Диапазон стадии" value={task.stageRange ?? "—"} />
        <Detail label="Время стадии" value={task.stageElapsed ?? "—"} />
        <Detail label="Скорость" value={task.speed} />
        <Detail label="ETA" value={task.eta} />
        <Detail label="Размер" value={task.size} />
        <Detail label="Сегмент/кадр" value={task.currentSegment ?? "—"} />
        <Detail label="Последний лог" value={task.lastLogLine ?? "—"} wide />
        {task.error && <Detail label="Ошибка" value={task.error} wide />}
      </div>
    )}
    </>
  );
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`${styles.detailCell} ${wide ? styles.detailCellWide : ""}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function RowAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "check" | "close" | "folder" | "more" | "move" | "trash";
  onClick: () => void;
}) {
  return (
    <button className={styles.iconButton} type="button" title={label} aria-label={label} onClick={onClick}>
      <RedesignIcon name={icon} className="size-[14px]" />
    </button>
  );
}
