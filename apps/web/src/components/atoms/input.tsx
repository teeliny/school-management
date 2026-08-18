import * as React from "react";
import { cn } from "../../lib/cn";

/**
 * A styled native <input> — not a Radix primitive, because a plain text
 * input has no complex interaction/ARIA to orchestrate (unlike Select or
 * DropdownMenu below). Kept consistent with those via the same design tokens.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-border bg-card-inset px-3 py-2.5 text-[13px] text-foreground",
        "placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-inset focus:ring-muted",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
