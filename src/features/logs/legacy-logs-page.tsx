import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LogViewer } from "@/components/log-viewer";
import { useLogs } from "@/stores/logs";

export function LegacyLogsPage() {
  const { t } = useTranslation();
  const lines = useLogs((state) => state.lines);
  const clear = useLogs((state) => state.clear);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = useMemo(() => {
    if (!filter) return lines;
    const value = filter.toLowerCase();
    return lines.filter((line) => line.id.startsWith(value) || line.line.toLowerCase().includes(value));
  }, [filter, lines]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-default px-4">
        <h1 className="text-[14px] font-semibold">{t("nav.logs")}</h1>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("logs.filter")}
          className="w-64 font-mono text-[12px]"
        />
        <label className="flex items-center gap-2 text-[12px] text-fg-secondary">
          <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
          {t("logs.autoscroll")}
        </label>
        <div className="ml-auto">
          <Button variant="ghost" size="md" onClick={() => clear()}>
            clear
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-3">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-fg-tertiary">
            {t("logs.empty")}
          </div>
        ) : (
          <LogViewer className="h-full max-h-[calc(100vh-96px)]" lines={filtered} autoScroll={autoScroll} />
        )}
      </div>
    </div>
  );
}
