import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-8 w-full rounded border border-border-default bg-elevated px-2.5 text-[13px] text-fg-primary placeholder:text-fg-tertiary",
        "transition-colors focus-visible:outline-none focus-visible:border-accent focus-visible:shadow-focus-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
