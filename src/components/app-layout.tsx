import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { ActivePresetPanel } from "@/components/active-preset-panel";
import { CommandPalette } from "@/components/command-palette";
import { Sidebar } from "@/components/sidebar";
import { TitleBar } from "@/components/title-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AddDialog } from "@/features/add/add-dialog";
import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import i18n from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useLogs } from "@/stores/logs";
import { useQueue, useJobCounts } from "@/stores/queue";
import { defaultPerformanceSettings, useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useWorkflowPresets } from "@/stores/workflowPresets";
import { FetchrAppShell } from "@/ui/redesign/layout";
import { CategorySidebar, type CategorySidebarItem, type CategorySidebarItemId } from "@/ui/redesign/sidebar";
import { TopAppBar } from "@/ui/redesign/topbar";
import { defaultWorkspaceLayouts, useWorkspaceLayouts } from "@/ui/redesign/workspace";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const togglePalette = useUI((s) => s.togglePalette);
  const openAdd = useUI((s) => s.openAddDialog);
  const initQueue = useQueue((s) => s.init);
  const initLogs = useLogs((s) => s.init);
  const setDirectory = useSettings((s) => s.setDirectory);
  const locale = useSettings((s) => s.locale);
  const directory = useSettings((s) => s.directory);
  const maxConcurrentJobs = useSettings((s) => s.maxConcurrentJobs);
  const hardwarePresetApplied = useRef(false);
  const redesignEnabled = isFetchrRedesignEnabled();
  const [searchValue, setSearchValue] = useState("");
  const counts = useJobCounts();
  const workspaceLayouts = useWorkspaceLayouts((s) => s.layouts);
  const activeWorkspaceId = useWorkspaceLayouts((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceLayouts((s) => s.setActiveWorkspace);
  const duplicateWorkspace = useWorkspaceLayouts((s) => s.duplicateWorkspace);
  const m3u8Presets = useWorkflowPresets((s) => s.m3u8Presets);
  const activeM3u8PresetId = useWorkflowPresets((s) => s.activeM3u8PresetId);
  const setActiveM3u8Preset = useWorkflowPresets((s) => s.setActiveM3u8Preset);
  const createM3u8Preset = useWorkflowPresets((s) => s.createM3u8Preset);
  const renameM3u8Preset = useWorkflowPresets((s) => s.renameM3u8Preset);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void initQueue().then((u) => unlisteners.push(u));
    void initLogs().then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
  }, [initQueue, initLogs]);

  useEffect(() => {
    if (!directory) {
      void ipc.defaultDownloadDir().then((d) => {
        if (d) setDirectory(d);
      });
    }
  }, [directory, setDirectory]);

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale]);

  useEffect(() => {
    if (hardwarePresetApplied.current) return;
    hardwarePresetApplied.current = true;
    void ipc.detectHardwarePreset().then((preset) => {
      const current = useSettings.getState();
      const profile = current.performance.profile ?? "auto";
      if (profile === "custom" || profile === "turbo") return;
      current.setPerformance({
        ...defaultPerformanceSettings,
        ...preset.performance,
      });
      current.setChatOverlay({
        ...current.chatOverlay,
        compose_mode: "direct",
        alpha_output_format: "mov_qtrle",
        chat_overlay_fps: 60,
        save_alpha_overlay: false,
        save_clean_video: true,
      });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const isTyping = isEditableKeyboardEvent(e);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openAdd();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        void navigate({ to: "/settings" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void ipc.startQueue(maxConcurrentJobs);
        return;
      }
      if (!isTyping && e.key.toLowerCase() === "g") {
        const handler = (e2: KeyboardEvent) => {
          if (e2.defaultPrevented || e2.isComposing || isEditableKeyboardEvent(e2)) return;
          if (e2.key === "q") void navigate({ to: "/queue" });
          if (e2.key === "l") void navigate({ to: "/logs" });
          if (e2.key === "f") void navigate({ to: "/finder" });
          if (e2.key === "c") void navigate({ to: "/chat-render" });
          if (e2.key === "p") void navigate({ to: "/sponsor-blur" });
          if (e2.key === "s") void navigate({ to: "/settings" });
          if (e2.key === "w") void navigate({ to: "/presets" });
          window.removeEventListener("keydown", handler);
        };
        window.addEventListener("keydown", handler, { once: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, openAdd, navigate, maxConcurrentJobs]);

  const workspaceTabs = useMemo(() => {
    const defaults = Object.values(defaultWorkspaceLayouts).map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
    }));
    const known = new Set(defaults.map((workspace) => workspace.id));
    const custom = Object.values(workspaceLayouts)
      .filter((layout) => !known.has(layout.id))
      .map((layout) => ({ id: layout.id, label: layout.name }));
    return [...defaults, ...custom];
  }, [workspaceLayouts]);

  const categoryItems = useMemo<CategorySidebarItem[]>(() => [
    {
      id: "queue",
      label: "Очередь",
      hint: "задачи и прогресс",
      icon: "queue",
      baseWorkspaceId: "fast",
      counter: counts.queued + counts.running,
    },
    {
      id: "finder",
      label: "M3U8 Finder",
      hint: "Twitch VOD и HLS",
      icon: "finder",
      baseWorkspaceId: "clean",
    },
    {
      id: "chat-render",
      label: "Рендер чата",
      hint: "Twitch / Kick",
      icon: "chat",
      baseWorkspaceId: "creator",
    },
    {
      id: "sponsor-blur",
      label: "Блюр спонсоров",
      hint: "зоны и пресеты",
      icon: "blur",
      baseWorkspaceId: "clean",
    },
    {
      id: "logs",
      label: "Логи",
      hint: "ошибки и диагностика",
      icon: "logs",
      baseWorkspaceId: "clean",
      counter: counts.error,
    },
    {
      id: "settings",
      label: "Настройки",
      hint: "инструменты и сеть",
      icon: "settings",
      baseWorkspaceId: "fast",
    },
  ], [counts.error, counts.queued, counts.running]);

  const activeCategory = useMemo<CategorySidebarItemId>(() => {
    if (pathname.startsWith("/finder")) return "finder";
    if (pathname.startsWith("/chat-render")) return "chat-render";
    if (pathname.startsWith("/sponsor-blur")) return "sponsor-blur";
    if (pathname.startsWith("/logs")) return "logs";
    if (pathname.startsWith("/settings")) return "settings";
    return "queue";
  }, [pathname]);

  const navigateCategory = (itemId: CategorySidebarItemId) => {
    const item = categoryItems.find((category) => category.id === itemId);
    if (item) setActiveWorkspace(item.baseWorkspaceId);
    if (itemId === "finder") void navigate({ to: "/finder" });
    else if (itemId === "chat-render") void navigate({ to: "/chat-render" });
    else if (itemId === "sponsor-blur") void navigate({ to: "/sponsor-blur" });
    else if (itemId === "logs") void navigate({ to: "/logs" });
    else if (itemId === "settings") void navigate({ to: "/settings" });
    else void navigate({ to: "/queue" });
  };

  const createCategoryWorkspace = (item: CategorySidebarItem) => {
    if (item.id === "finder") {
      createM3u8Preset(activeM3u8PresetId);
      void navigate({ to: "/finder" });
      return;
    }
    duplicateWorkspace(item.baseWorkspaceId, `${item.label} Copy`);
    void navigate({ to: "/presets" });
  };

  if (redesignEnabled) {
    return (
      <TooltipProvider delayDuration={300}>
        <FetchrAppShell
          sidebar={
            pathname.startsWith("/presets") ? undefined : (
              <CategorySidebar
                activeItem={activeCategory}
                items={categoryItems}
                onNavigate={navigateCategory}
                onCreatePreset={createCategoryWorkspace}
                m3u8Presets={m3u8Presets}
                activeM3u8PresetId={activeM3u8PresetId}
                onSelectM3u8Preset={(presetId) => {
                  setActiveM3u8Preset(presetId);
                  void navigate({ to: "/finder" });
                }}
                onRenameM3u8Preset={renameM3u8Preset}
              />
            )
          }
          sidebarWidth={236}
          topBar={
            <TopAppBar
              version="v0.2.0"
              activeWorkspace={activeWorkspaceId}
              workspaces={workspaceTabs}
              searchValue={searchValue}
              notificationCount={counts.error}
              onSearchChange={setSearchValue}
              onAddTask={openAdd}
              onRunAll={() => void ipc.startQueue(maxConcurrentJobs)}
              onOpenSettings={() => void navigate({ to: "/settings" })}
              onWorkspaceChange={(workspaceId) => {
                setActiveWorkspace(workspaceId);
                void navigate({ to: "/presets" });
              }}
              onCreateWorkspace={() => {
                duplicateWorkspace(activeWorkspaceId, `Workspace ${workspaceTabs.length + 1}`);
                void navigate({ to: "/presets" });
              }}
              onOpenNotifications={() => void navigate({ to: "/logs" })}
              hideWorkspaceTabs={pathname.startsWith("/presets")}
            />
          }
        >
          {children}
        </FetchrAppShell>
        <CommandPalette />
        <AddDialog />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-fg-primary">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
          <ActivePresetPanel />
        </div>
        <CommandPalette />
        <AddDialog />
      </div>
    </TooltipProvider>
  );
}

function isEditableKeyboardEvent(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];

  return path.some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.isContentEditable) return true;

    const tagName = node.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;

    const role = node.getAttribute("role");
    return role === "textbox" || role === "searchbox" || role === "combobox";
  });
}
