import styles from "./PresetInspector.module.css";

export interface PresetStep {
  id: string;
  title: string;
  description?: string;
}

export interface PresetStepListProps {
  steps: readonly PresetStep[];
}

export function PresetStepList({ steps }: PresetStepListProps) {
  return (
    <section className={styles.section} aria-label="Шаги обработки пресета">
      <div className={styles.sectionTitle}>Обработка ({steps.length} шагов)</div>
      <div className={styles.stepList}>
        {steps.map((step, index) => (
          <div className={styles.step} key={step.id}>
            <span className={styles.stepIndex}>{index + 1}</span>
            <div className={styles.stepText}>
              <div className={styles.stepTitle} title={step.title}>
                {step.title}
              </div>
              {step.description && (
                <div className={styles.stepDescription} title={step.description}>
                  {step.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
