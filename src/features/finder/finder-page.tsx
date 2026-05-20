import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { LegacyFinderPage } from "@/features/finder/legacy-finder-page";
import { M3U8FinderPage } from "@/ui/redesign/m3u8";

export function FinderPage() {
  return isFetchrRedesignEnabled() ? <M3U8FinderPage /> : <LegacyFinderPage />;
}
