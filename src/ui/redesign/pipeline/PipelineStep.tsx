import { cn } from "@/lib/utils";

import styles from "./ProcessingPipeline.module.css";

export interface PipelineStepData {
  id: string;
  title: string;
  description?: string;
}

export interface PipelineStepProps {
  step: PipelineStepData;
  index: number;
  active?: boolean;
}

export function PipelineStep({ step, index, active = false }: PipelineStepProps) {
  return (
    <div className={cn(styles.step, active && styles.stepActive)}>
      <span className={styles.index}>{index + 1}</span>
      <div className={styles.text}>
        <div className={styles.stepTitle} title={step.title}>
          {step.title}
        </div>
        {step.description && (
          <div className={styles.description} title={step.description}>
            {step.description}
          </div>
        )}
      </div>
    </div>
  );
}
