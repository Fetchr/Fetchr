import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { LegacySettingsPage } from "@/features/settings/legacy-settings-page";
import { SettingsPage as RedesignSettingsPage } from "@/ui/redesign/settings";

export function SettingsPage() {
  return isFetchrRedesignEnabled() ? <RedesignSettingsPage /> : <LegacySettingsPage />;
}
