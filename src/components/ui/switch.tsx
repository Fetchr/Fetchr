import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-border-default bg-elevated transition-colors focus-visible:outline-none focus-visible:shadow-focus-ring",
      "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3 w-3 rounded-full bg-fg-primary shadow-sm ring-0 transition-transform",
        "translate-x-0.5 data-[state=checked]:translate-x-3.5",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
