import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, KeyRound, Loader2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc, type BetaActivationLink, type LicenseStatus } from "@/lib/ipc";

interface LicenseGateProps {
  children: React.ReactNode;
}

export function LicenseGate({ children }: LicenseGateProps) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activationLink, setActivationLink] = useState<BetaActivationLink | null>(null);

  const active = status?.state === "active";
  const machineId = status?.machine_id ?? "";
  const displayName = useMemo(() => {
    const license = status?.license;
    return license?.name || license?.note || null;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([ipc.licenseStatus(), ipc.betaActivationLink()])
      .then(([next, link]) => {
        if (!cancelled) {
          setStatus(next);
          setActivationLink(link);
          setError(next.state === "invalid" ? next.message : null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyMachineId = async () => {
    if (!machineId) return;
    await navigator.clipboard.writeText(machineId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const openTelegramBot = async () => {
    if (!activationLink?.telegram_url) {
      await copyMachineId();
      return;
    }
    await openUrl(activationLink.telegram_url);
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await ipc.activateLicense(key);
      setStatus(next);
      setKey("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await ipc.licenseStatus();
      setStatus(next);
      setError(next.state === "invalid" ? next.message : null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (busy && !status) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas text-fg-secondary">
        <div className="flex items-center gap-2 text-[13px]">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Проверка лицензии
        </div>
      </div>
    );
  }

  if (active) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas px-5 text-fg-primary">
      <div className="w-full max-w-xl border border-border-default bg-surface">
        <header className="flex items-center gap-3 border-b border-border-default px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-accent/30 bg-accent/10 text-accent">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold">Активация Fetchr Beta</h1>
            <p className="mt-0.5 text-[12px] text-fg-tertiary">
              Ключ привязывается к этому Windows-устройству.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="rounded border border-border-default bg-elevated p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
                Machine ID
              </span>
              <Button variant="secondary" size="sm" onClick={copyMachineId} disabled={!machineId}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                {copied ? "Скопировано" : "Копировать"}
              </Button>
            </div>
            <div className="select-text break-all font-mono text-[13px] text-fg-primary">
              {machineId || "Machine ID пока не получен"}
            </div>
          </div>

          <div className="rounded border border-border-default bg-elevated p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
                Telegram beta bot
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={openTelegramBot}
                disabled={!machineId || busy}
              >
                <Send className="h-3.5 w-3.5" />
                Открыть бота
              </Button>
            </div>
            <div className="text-[12px] leading-5 text-fg-secondary">
              Бот получит этот Machine ID, выдаст персональный ключ и привяжет доступ к этому устройству.
              {!activationLink?.configured && (
                <span className="mt-1 block text-fg-tertiary">
                  Бот не настроен в сборке: задайте FETCHR_TG_BETA_BOT.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[12px] text-fg-secondary" htmlFor="license-key">
              Лицензионный ключ
            </label>
            <div className="flex gap-2">
              <Input
                id="license-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && key.trim()) void activate();
                }}
                placeholder="FTR1.payload.signature"
                className="h-9 font-mono text-[12px]"
              />
              <Button variant="primary" size="lg" onClick={activate} disabled={busy || !key.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Активировать
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}

          {status?.state === "invalid" && (
            <Button variant="secondary" size="sm" onClick={refreshStatus} disabled={busy} className="self-start">
              <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Проверить еще раз
            </Button>
          )}

          {displayName && (
            <div className="text-[11px] text-fg-tertiary">Текущая лицензия: {displayName}</div>
          )}
        </div>
      </div>
    </div>
  );
}
