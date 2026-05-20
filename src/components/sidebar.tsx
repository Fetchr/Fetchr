import { Link } from "@tanstack/react-router";
import type { ElementType } from "react";
import {
  CheckCircle2,
  Github,
  ListVideo,
  MessageCircle,
  MessageSquareText,
  Radar,
  ScanSearch,
  ScrollText,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useJobCounts } from "@/stores/queue";

interface ItemProps {
  to: string;
  icon: ElementType;
  label: string;
  counter?: number;
}

function Item({ to, icon: Icon, label, counter }: ItemProps) {
  return (
    <Link
      to={to}
      activeProps={{
        className:
          "border-accent/45 bg-accent/16 text-fg-primary shadow-[inset_0_0_0_1px_hsl(var(--accent)/0.18)]",
      }}
      inactiveProps={{
        className:
          "border-transparent text-fg-secondary hover:border-border-default hover:bg-elevated hover:text-fg-primary",
      }}
      className={cn(
        "flex h-10 items-center gap-3 rounded-md border px-3 text-[13px] transition-colors",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
      {counter !== undefined && counter > 0 && (
        <span className="rounded-full bg-accent/22 px-2 py-[1px] font-mono text-[10px] text-fg-primary tabular">
          {counter}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const counts = useJobCounts();
  const total = counts.done + counts.queued + counts.running + counts.error + counts.paused;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border-default bg-[#0d1218]/96 px-4 py-5">
      <nav className="flex flex-1 flex-col gap-1.5">
        <Item to="/queue" icon={ListVideo} label={t("nav.queue")} counter={counts.queued + counts.running} />
        <Item to="/logs" icon={ScrollText} label={t("nav.logs")} />
        <Item to="/finder" icon={Radar} label={t("nav.finder")} />
        <Item to="/chat-render" icon={MessageSquareText} label={t("nav.chat_render")} />
        <Item to="/sponsor-blur" icon={ScanSearch} label={t("nav.sponsor_blur")} />
        <div className="mt-3 h-px bg-border-subtle" />
        <Item to="/settings" icon={Settings} label={t("nav.settings")} />
      </nav>

      <div className="grid gap-4">
        <section className="rounded-lg border border-border-default bg-surface/80 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase text-fg-tertiary">
            <span>Движок</span>
            <span className="inline-flex items-center gap-1 text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Активен
            </span>
          </div>
          <div className="grid gap-2 text-[11px] text-fg-secondary">
            <Metric label="Потоки" value={`${counts.running} / ${Math.max(1, total)}`} />
            <Metric label="CPU" value="Auto" />
            <Metric label="RAM" value="Auto" />
            <Metric label="Диск" value="Готов" />
          </div>
        </section>

        <div className="flex items-center gap-3 text-fg-tertiary">
          <Github className="h-4 w-4" />
          <MessageCircle className="h-4 w-4" />
        </div>

        <section className="rounded-lg border border-border-default bg-surface/80 p-3">
          <div className="flex items-center gap-2 text-[12px] text-success">
            <CheckCircle2 className="h-4 w-4" />
            Лицензия активна
          </div>
          <div className="mt-2 truncate font-mono text-[10.5px] text-fg-tertiary">
            Machine ID: 20722A...A563
          </div>
        </section>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-tertiary">{label}</span>
      <span className="font-mono tabular">{value}</span>
    </div>
  );
}
