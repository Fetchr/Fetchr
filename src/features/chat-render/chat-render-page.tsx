import { isFetchrRedesignEnabled } from "@/config/featureFlags";
import { LegacyChatRenderPage } from "@/features/chat-render/legacy-chat-render-page";
import { ChatRenderPage as RedesignChatRenderPage } from "@/ui/redesign/chat-render";

export function ChatRenderPage() {
  return isFetchrRedesignEnabled() ? <RedesignChatRenderPage /> : <LegacyChatRenderPage />;
}
