import type { HardwarePreset } from "@/lib/ipc";
import { defaultPerformanceSettings } from "@/stores/settings";
import type { PerformanceSettings } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import { SettingsRow } from "./GeneralSettingsCard";
import styles from "./SettingsPage.module.css";

interface PerformanceSettingsCardProps {
  performance: PerformanceSettings;
  hardware: HardwarePreset | null;
  detectingHardware: boolean;
  onPerformanceChange: (performance: PerformanceSettings) => void;
  onDetectHardware: (apply: boolean) => void;
}

export function PerformanceSettingsCard({
  performance,
  hardware,
  detectingHardware,
  onPerformanceChange,
  onDetectHardware,
}: PerformanceSettingsCardProps) {
  const update = (patch: Partial<PerformanceSettings>) => {
    onPerformanceChange({ ...defaultPerformanceSettings, ...performance, ...patch });
  };

  const updateProfile = (profile: PerformanceSettings["profile"]) => {
    if (profile === "turbo") {
      const cores = navigator.hardwareConcurrency || 8;
      update({
        profile,
        network_concurrent_fragments: 32,
        cpu_threads: cores,
        render_workers: cores,
      });
      return;
    }
    update({ profile });
  };

  return (
    <section className={styles.card} id="settings-performance">
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <RedesignIcon name="performance" />
          Производительность
        </div>
        <div className={styles.cardHint}>Параллельность, CPU/GPU и FFmpeg preset</div>
      </div>
      <div className={styles.cardBody}>
        <SettingsRow label="Автопресет" help="Определяет CPU/GPU и может применить безопасный быстрый профиль.">
          <div className={styles.fieldGroup}>
            <span className={styles.pill}>{hardware ? hardwareSummary(hardware) : "Железо пока не определено"}</span>
            <button className={styles.button} type="button" onClick={() => onDetectHardware(false)} disabled={detectingHardware}>
              <RedesignIcon name={detectingHardware ? "loading" : "refresh"} className={detectingHardware ? "animate-spin" : undefined} />
              Обновить
            </button>
            <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={() => onDetectHardware(true)} disabled={detectingHardware}>
              Лучший пресет
            </button>
          </div>
        </SettingsRow>

        <SettingsRow label="Профиль">
          <select
            className={styles.select}
            value={performance.profile}
            onChange={(event) => updateProfile(event.target.value as PerformanceSettings["profile"])}
          >
            <option value="auto">Авто</option>
            <option value="maximum">Максимум</option>
            <option value="turbo">Турбо</option>
            <option value="custom">Пользовательский</option>
          </select>
          {performance.profile === "turbo" && (
            <div className={styles.help}>
              Турбо сильнее грузит CPU/GPU, диск и сеть.
            </div>
          )}
        </SettingsRow>

        <SettingsRow label="Сеть / CPU" help="CPU и Render = 0 означает автоматический режим.">
          <div className={styles.numberGrid}>
            <NumberField label="Net" value={performance.network_concurrent_fragments} onChange={(value) => update({ profile: "custom", network_concurrent_fragments: clamp(value, 1, 32) })} />
            <NumberField label="CPU" value={performance.cpu_threads ?? 0} onChange={(value) => update({ profile: "custom", cpu_threads: value > 0 ? Math.max(1, value) : null })} />
            <NumberField label="Render" value={performance.render_workers ?? 0} onChange={(value) => update({ profile: "custom", render_workers: value > 0 ? Math.max(1, value) : null })} />
          </div>
        </SettingsRow>

        <SettingsRow label="GPU encoder" help="Backend уже содержит fallback, если выбранный кодер не стартует.">
          <div className={styles.fieldGroup}>
            <select
              className={styles.select}
              value={performance.gpu_encoder_mode}
              onChange={(event) => update({ profile: "custom", gpu_encoder_mode: event.target.value as PerformanceSettings["gpu_encoder_mode"] })}
            >
              <option value="auto">Auto detect</option>
              <option value="intel_xe_qsv">Intel Xe QSV</option>
              <option value="nvenc">NVIDIA NVENC</option>
              <option value="qsv">Intel QSV</option>
              <option value="amf">AMD AMF</option>
              <option value="cpu">CPU libx264</option>
            </select>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={performance.ffmpeg_preset ?? ""}
              placeholder="preset: p4 / veryfast / speed"
              onChange={(event) => update({ profile: "custom", ffmpeg_preset: event.target.value || null })}
            />
          </div>
        </SettingsRow>
      </div>
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className={styles.fieldGroup}>
      <span className={styles.help}>{label}</span>
      <input className={`${styles.input} ${styles.mono}`} type="number" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </label>
  );
}

function hardwareSummary(hardware: HardwarePreset) {
  const gpu = hardware.gpu_names.length ? hardware.gpu_names.join(" / ") : "GPU не найден";
  return `${hardware.cpu_logical_cores} CPU threads · ${encoderLabel(hardware.performance.gpu_encoder_mode)} · ${gpu}`;
}

function encoderLabel(value: string) {
  if (value === "intel_xe_qsv") return "Intel Xe QSV";
  if (value === "qsv") return "Intel QSV";
  if (value === "nvenc") return "NVIDIA NVENC";
  if (value === "amf") return "AMD AMF";
  if (value === "cpu") return "CPU";
  return "Auto";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value) || min));
}
