import { Command } from "cmdk";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  ListVideo,
  ScrollText,
  Settings,
  FolderOpen,
  Languages,
  Radar,
  MessageSquareText,
  ScanSearch,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc";
import { useUI } from "@/stores/ui";
import { useSettings } from "@/stores/settings";
import { Kbd } from "./kbd";

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const close = useUI((s) => s.closePalette);
  const openAdd = useUI((s) => s.openAddDialog);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = useSettings((s) => s.locale);
  const setLocale = useSettings((s) => s.setLocale);
  const directory = useSettings((s) => s.directory);
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const run = (fn: () => void | Promise<void>) => {
    close();
    void Promise.resolve().then(fn);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh] backdrop-blur-[2px] animate-fade-in"
      onClick={close}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border-default bg-surface shadow-overlay animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder={t("palette.placeholder")}
            className="h-11 w-full border-b border-border-default bg-transparent px-4 text-[14px] text-fg-primary outline-none placeholder:text-fg-tertiary"
          />
          <Command.List className="max-h-[420px] overflow-auto p-1.5">
            <Command.Empty className="p-6 text-center text-[12px] text-fg-tertiary">
              —
            </Command.Empty>

            <Command.Group
              heading={t("palette.group_actions")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-tertiary"
            >
              <Item icon={Plus} label={t("palette.add_stream")} hint={["Ctrl", "N"]} onSelect={() => run(openAdd)} />
              <Item icon={Play} label={t("palette.start_queue")} hint={["Ctrl", "Enter"]} onSelect={() => run(() => ipc.startQueue(maxConcurrentJobs))} />
              <Item icon={Pause} label={t("palette.pause_queue")} onSelect={() => run(() => ipc.pauseQueue())} />
              <Item icon={Trash2} label={t("palette.clear_completed")} onSelect={() => run(() => ipc.clearCompleted())} />
            </Command.Group>

            <Command.Group
              heading={t("palette.group_navigate")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-tertiary"
            >
              <Item icon={ListVideo} label={t("palette.goto_queue")} hint={["G", "Q"]} onSelect={() => run(() => navigate({ to: "/queue" }))} />
              <Item icon={ScrollText} label={t("palette.goto_logs")} hint={["G", "L"]} onSelect={() => run(() => navigate({ to: "/logs" }))} />
              <Item icon={Radar} label={t("palette.goto_finder")} hint={["G", "F"]} onSelect={() => run(() => navigate({ to: "/finder" }))} />
              <Item icon={MessageSquareText} label={t("palette.goto_chat_render")} hint={["G", "C"]} onSelect={() => run(() => navigate({ to: "/chat-render" }))} />
              <Item icon={ScanSearch} label={t("palette.goto_sponsor_blur")} hint={["G", "P"]} onSelect={() => run(() => navigate({ to: "/sponsor-blur" }))} />
              <Item icon={Settings} label={t("palette.goto_settings")} hint={["Ctrl", ","]} onSelect={() => run(() => navigate({ to: "/settings" }))} />
            </Command.Group>

            <Command.Group
              heading={t("palette.group_actions")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-tertiary"
            >
              <Item
                icon={FolderOpen}
                label={t("palette.open_downloads")}
                onSelect={() =>
                  run(() => {
                    if (directory) void ipc.openFolder(directory);
                  })
                }
              />
              <Item
                icon={Languages}
                label={t("palette.toggle_language")}
                onSelect={() =>
                  run(() => {
                    const next = locale === "ru" ? "en" : "ru";
                    setLocale(next);
                    void i18n.changeLanguage(next);
                    localStorage.setItem("fetchr-locale", next);
                  })
                }
              />
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

interface ItemProps {
  icon: React.ElementType;
  label: string;
  hint?: string[];
  onSelect: () => void;
}

function Item({ icon: Icon, label, hint, onSelect }: ItemProps) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-fg-secondary data-[selected=true]:bg-overlay data-[selected=true]:text-fg-primary"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span className="flex-1">{label}</span>
      {hint && (
        <div className="flex items-center gap-1">
          {hint.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </div>
      )}
    </Command.Item>
  );
}
