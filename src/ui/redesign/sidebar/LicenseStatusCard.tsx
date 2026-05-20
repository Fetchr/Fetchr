import { cn } from "@/lib/utils";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./LeftNavigation.module.css";

export interface LicenseStatusCardProps {
  active?: boolean;
  machineId?: string | null;
  onCopyMachineId?: () => void;
  className?: string;
}

export function LicenseStatusCard({
  active = true,
  machineId,
  onCopyMachineId,
  className,
}: LicenseStatusCardProps) {
  const shortMachineId = shortenMachineId(machineId);

  return (
    <section className={cn(styles.card, styles.licenseCard, className)} aria-label="Состояние лицензии">
      <div className={cn(styles.licenseStatus, !active && styles.licenseInactive)}>
        <RedesignIcon name={active ? "check" : "alert"} className="size-[15px]" />
        {active ? "Лицензия активна" : "Лицензия не активна"}
      </div>

      <div className={styles.machineRow}>
        <div className={styles.machineId}>Machine ID: {shortMachineId}</div>
        {machineId && onCopyMachineId && (
          <button className={styles.copyButton} type="button" aria-label="Скопировать Machine ID" onClick={onCopyMachineId}>
            <RedesignIcon name="copy" className="size-[13px]" />
          </button>
        )}
      </div>
    </section>
  );
}

function shortenMachineId(machineId?: string | null): string {
  if (!machineId) return "Не определен";
  if (machineId.length <= 14) return machineId;
  return `${machineId.slice(0, 7)}...${machineId.slice(-4)}`;
}
