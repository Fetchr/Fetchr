import fetchrLogo from "@/assets/fetchr-logo.png";
import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      className={cn(
        "h-7 w-7 shrink-0 rounded-md object-contain",
        className,
      )}
      src={fetchrLogo}
      alt=""
      aria-hidden
    />
  );
}
