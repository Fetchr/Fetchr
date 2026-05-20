import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./ProcessingPipeline.module.css";
import { PipelineStep, type PipelineStepData } from "./PipelineStep";

export interface ProcessingPipelineProps {
  presetName?: string;
  steps?: readonly PipelineStepData[];
  activeStepId?: string | null;
  className?: string;
}

export const defaultProcessingSteps: PipelineStepData[] = [
  { id: "quality", title: "Выбор качества", description: "Ручной выбор" },
  { id: "preview", title: "Предпросмотр", description: "Проверка потока" },
  { id: "clips", title: "Таймкоды и клипы", description: "Сбор фрагментов" },
  { id: "split", title: "Нарезка файла", description: "Разделение файла" },
  { id: "sponsorBlur", title: "Блюр спонсоров", description: "Применение зон" },
  { id: "resolve", title: "Распознавание ссылки", description: "Анализ и метаданные" },
];

export function ProcessingPipeline({
  presetName,
  steps = defaultProcessingSteps,
  activeStepId,
  className,
}: ProcessingPipelineProps) {
  return (
    <section className={`${fetchrThemeClassName} ${styles.pipeline} ${className ?? ""}`} aria-label="Конвейер обработки">
      <div className={styles.title}>Конвейер обработки{presetName ? ` (${presetName})` : ""}</div>
      <div className={styles.scroll}>
        {steps.length === 0 ? (
          <div className={styles.empty}>В пресете пока нет шагов обработки.</div>
        ) : (
          steps.map((step, index) => (
            <div className={styles.stepGroup} key={step.id}>
              <PipelineStep step={step} index={index} active={activeStepId === step.id} />
              {index < steps.length - 1 && (
                <span className={styles.connector} aria-hidden>
                  <RedesignIcon name="check" className="size-[13px]" />
                  <RedesignIcon name="link" className="size-[13px]" />
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
