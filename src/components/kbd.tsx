import { cn } from "@/lib/utils";

interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm",
        "border border-border-default bg-elevated px-1",
        "font-mono text-[10px] font-semibold text-fg-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
