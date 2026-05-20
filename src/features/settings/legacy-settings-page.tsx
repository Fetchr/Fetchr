import { useEffect, useState } from "react";
import { Check, Clipboard, Cpu, FolderOpen, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ipc, type HardwarePreset, type LicenseStatus } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { defaultPerformanceSettings, useSettings } from "@/stores/settings";
import type { BinaryReport, PerformanceSettings } from "@/types/job";

export function LegacySettingsPage() {
  const settings = useSettings();
  const [binaries, setBinaries] = useState<BinaryReport[]>([]);
  const [hardware, setHardware] = useState<HardwarePreset | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);
  const performance = settings.performance ?? defaultPerformanceSettings;

  useEffect(() => {
    if (!settings.directory) {
      void ipc.defaultDownloadDir().then((directory) => {
        if (directory) settings.setDirectory(directory);
      });
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void ipc.detectBinaries(settings.binariesDir).then((reports) => {
      if (!cancelled) setBinaries(reports);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.binariesDir]);

  useEffect(() => {
    void detectHardware(false);
    void ipc.licenseStatus().then(setLicense).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDir = async () => {
    const directory = await ipc.chooseDirectory();
    if (directory) settings.setDirectory(directory);
  };

  const chooseBinariesDir = async () => {
    const directory = await ipc.chooseDirectory();
    if (directory) settings.setBinariesDir(directory);
  };

  const detectHardware = async (apply: boolean) => {
    setDetecting(true);
    try {
      const preset = await ipc.detectHardwarePreset();
      setHardware(preset);
      if (apply) applyHardwarePreset(preset);
    } finally {
      setDetecting(false);
    }
  };

  const applyHardwarePreset = (preset = hardware) => {
    if (!preset) return;
    settings.setPerformance({ ...defaultPerformanceSettings, ...preset.performance });
    settings.setChatOverlay({
      ...settings.chatOverlay,
      compose_mode: "direct",
      alpha_output_format: "mov_qtrle",
      chat_overlay_fps: 60,
      save_alpha_overlay: false,
      save_clean_video: true,
    });
  };

  const resetLicense = async () => {
    setResetting(true);
    try {
      const next = await ipc.resetLicense();
      setLicense(next);
      window.setTimeout(() => window.location.reload(), 250);
    } finally {
      setResetting(false);
    }
  };

  const copyMachineId = async () => {
    if (!license?.machine_id) return;
    await navigator.clipboard.writeText(license.machine_id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const updatePerformance = (patch: Partial<PerformanceSettings>) => {
    settings.setPerformance({ ...defaultPerformanceSettings, ...performance, ...patch });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border-default px-4">
        <h1 className="text-[14px] font-semibold">Настройки</h1>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl">
          <Section title="Общие">
            <Row label="Язык">
              <Select value={settings.locale} onValueChange={(value) => settings.setLocale(value as "ru" | "en")}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Папка по умолчанию">
              <div className="flex w-full gap-1.5">
                <Input value={settings.directory} onChange={(event) => settings.setDirectory(event.target.value)} className="font-mono text-[12px]" />
                <Button variant="secondary" size="md" onClick={chooseDir}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Обзор...
                </Button>
              </div>
            </Row>
            <Row label="Шаблон имени">
              <Input value={settings.filenameTemplate} onChange={(event) => settings.setFilenameTemplate(event.target.value)} className="font-mono text-[12px]" />
            </Row>
            <Row label="Parallel downloads">
              <Input type="number" min={1} max={6} value={settings.maxConcurrentJobs} onChange={(event) => settings.setMaxConcurrentJobs(Number(event.target.value))} className="w-24 font-mono text-[12px]" />
            </Row>
          </Section>

          <Section title="Лицензия beta">
            <Row label="Статус">
              <Status active={license?.state === "active"} text={license?.state === "active" ? "Активирована" : license?.state === "invalid" ? "Ключ повреждён или не подходит" : "Ключ не введён"} />
            </Row>
            <Row label="Machine ID">
              <div className="flex w-full gap-1.5">
                <Input value={license?.machine_id ?? ""} readOnly className="font-mono text-[12px]" />
                <Button variant="secondary" size="md" onClick={copyMachineId} disabled={!license?.machine_id}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                  {copied ? "ОК" : "Копировать"}
                </Button>
              </div>
            </Row>
            <Row label="Сброс">
              <Button variant="danger" size="md" onClick={resetLicense} disabled={resetting}>
                <RefreshCw className={resetting ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                Сбросить ключ
              </Button>
            </Row>
          </Section>

          <Section title="Инструменты">
            <Row label="Папка с yt-dlp / N_m3u8DL-RE / ffmpeg">
              <div className="flex w-full gap-1.5">
                <Input value={settings.binariesDir ?? ""} onChange={(event) => settings.setBinariesDir(event.target.value || null)} placeholder="Автоопределение" className="font-mono text-[12px]" />
                <Button variant="secondary" size="md" onClick={chooseBinariesDir}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Обзор...
                </Button>
              </div>
            </Row>
            <div className="flex flex-col gap-1 rounded border border-border-default bg-elevated p-2">
              {binaries.map((binary) => (
                <div key={binary.name} className="flex items-center gap-2 px-1 py-1 text-[12px]">
                  <StatusIcon active={binary.found} />
                  <span className="font-mono">{binary.name}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-fg-tertiary">{binary.path ?? "Не найдено"}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Сеть">
            <Row label="Использовать прокси">
              <Switch checked={settings.proxy.enabled} onCheckedChange={(enabled) => settings.setProxy({ ...settings.proxy, enabled })} />
            </Row>
            <Row label="Прокси">
              <Input value={settings.proxy.url} onChange={(event) => settings.setProxy({ ...settings.proxy, url: event.target.value })} className="font-mono text-[12px]" />
            </Row>
          </Section>

          <Section title="Производительность">
            <div className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-fg-secondary">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>{hardware ? `${hardware.cpu_logical_cores} CPU threads, ${hardware.performance.gpu_encoder_mode}` : "Определение железа..."}</span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => void detectHardware(true)} disabled={detecting}>
                    <RefreshCw className={detecting ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                    Авто
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => applyHardwarePreset()} disabled={!hardware}>
                    Лучший пресет
                  </Button>
                </div>
              </div>
            </div>
            <Row label="Профиль">
              <Select
                value={performance.profile}
                onValueChange={(profile) => {
                  if (profile === "turbo") {
                    const cores = navigator.hardwareConcurrency || 8;
                    updatePerformance({
                      profile: "turbo",
                      network_concurrent_fragments: 32,
                      cpu_threads: cores,
                      render_workers: cores,
                    });
                    return;
                  }
                  updatePerformance({ profile: profile as PerformanceSettings["profile"] });
                }}
              >
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Авто</SelectItem>
                  <SelectItem value="maximum">Максимум</SelectItem>
                  <SelectItem value="turbo">Турбо</SelectItem>
                  <SelectItem value="custom">Пользовательский</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Сеть / CPU">
              <div className="grid grid-cols-3 gap-2">
                <NumberInput label="Net" value={performance.network_concurrent_fragments} onChange={(value) => updatePerformance({ profile: "custom", network_concurrent_fragments: value })} />
                <NumberInput label="CPU" value={performance.cpu_threads ?? 0} onChange={(value) => updatePerformance({ profile: "custom", cpu_threads: value > 0 ? value : null })} />
                <NumberInput label="Render" value={performance.render_workers ?? 0} onChange={(value) => updatePerformance({ profile: "custom", render_workers: value > 0 ? value : null })} />
              </div>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border-default px-6 py-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex w-44 items-center gap-1.5 pt-1.5 text-[12px] text-fg-secondary">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Status({ active, text }: { active: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <StatusIcon active={active} />
      <span>{text}</span>
    </div>
  );
}

function StatusIcon({ active }: { active: boolean }) {
  return (
    <span className={cn("flex h-5 w-5 items-center justify-center rounded-sm", active ? "bg-success/20 text-success" : "bg-danger/20 text-danger")}>
      {active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
    </span>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-10 text-[11px] text-fg-tertiary">{label}</span>
      <Input type="number" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} className="font-mono text-[12px]" />
    </label>
  );
}
