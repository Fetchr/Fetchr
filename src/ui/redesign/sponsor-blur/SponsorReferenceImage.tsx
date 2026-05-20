import { LocalImage } from "@/components/local-image";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { RemoteImage } from "@/ui/redesign/media/RemoteImage";

import type { SponsorPreviewSource } from "./SponsorVideoPreview";
import styles from "./SponsorBlurPage.module.css";

interface SponsorReferenceImageProps {
  reference: SponsorPreviewSource | null;
  referenceUrl: string;
  onReferenceUrlChange: (value: string) => void;
  onUseReferenceUrl: () => void;
  onChooseReferenceFile: () => void;
  onClearReference: () => void;
}

export function SponsorReferenceImage({
  reference,
  referenceUrl,
  onReferenceUrlChange,
  onUseReferenceUrl,
  onChooseReferenceFile,
  onClearReference,
}: SponsorReferenceImageProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <RedesignIcon name="image" />
          Reference-фото
        </div>
      </div>
      <div className={`${styles.panelBody} ${styles.propertiesGrid}`}>
        <div className={styles.referenceImage}>
          {reference ? (
            reference.kind === "local" ? (
              <LocalImage path={reference.src} alt="Reference" />
            ) : (
              <RemoteImage src={reference.src} alt="Reference" fallbackLabel="Ref" fit="contain" />
            )
          ) : (
            <span>Reference не выбран</span>
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Reference image URL</span>
          <input
            className={`${styles.input} ${styles.mono}`}
            value={referenceUrl}
            placeholder="https://..."
            onChange={(event) => onReferenceUrlChange(event.target.value)}
          />
        </label>

        <div className={styles.twoColumn}>
          <button className={styles.button} type="button" onClick={onUseReferenceUrl}>
            <RedesignIcon name="link" />
            URL
          </button>
          <button className={styles.button} type="button" onClick={onChooseReferenceFile}>
            <RedesignIcon name="folder" />
            Файл
          </button>
        </div>

        {reference && <div className={styles.pathBox}>{reference.src}</div>}

        <button className={`${styles.button} ${styles.dangerButton}`} type="button" onClick={onClearReference}>
          <RedesignIcon name="trash" />
          Убрать
        </button>
      </div>
    </section>
  );
}
