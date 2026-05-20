import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

import { AppLayout } from "@/components/app-layout";
import { QueuePage } from "@/features/queue/queue-page";
import { LogsPage } from "@/features/logs/logs-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { FinderPage } from "@/features/finder/finder-page";
import { ChatRenderPage } from "@/features/chat-render/chat-render-page";
import { SponsorBlurPage } from "@/features/sponsor-blur/sponsor-blur-page";
import { PresetBuilderPage } from "@/features/presets/preset-builder-page";

const rootRoute = createRootRoute({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw new Error("redirecting");
  },
  component: () => null,
});

const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/queue",
  component: QueuePage,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  component: LogsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const finderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finder",
  component: FinderPage,
});

const chatRenderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat-render",
  component: ChatRenderPage,
});

const presetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/presets",
  component: PresetBuilderPage,
});

const sponsorBlurRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sponsor-blur",
  component: SponsorBlurPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  queueRoute,
  logsRoute,
  finderRoute,
  presetsRoute,
  chatRenderRoute,
  sponsorBlurRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/queue"] }),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
