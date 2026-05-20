import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { LegacySponsorBlurPage } from "@/features/sponsor-blur/legacy-sponsor-blur-page";
import { SponsorBlurPage as RedesignSponsorBlurPage } from "@/ui/redesign/sponsor-blur";

export function SponsorBlurPage() {
  return isFetchrRedesignEnabled() ? <RedesignSponsorBlurPage /> : <LegacySponsorBlurPage />;
}
