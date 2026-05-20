import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { LegacyLogsPage } from "@/features/logs/legacy-logs-page";
import { LogsPage as RedesignLogsPage } from "@/ui/redesign/logs";

export function LogsPage() {
  return isFetchrRedesignEnabled() ? <RedesignLogsPage /> : <LegacyLogsPage />;
}
