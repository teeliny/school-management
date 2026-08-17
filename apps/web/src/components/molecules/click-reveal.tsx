"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/cn";

/**
 * Minimal click-to-reveal popover — reuses Radix DropdownMenu's primitives
 * (already a dependency, same building block student-combobox.tsx uses)
 * purely for their positioned-portal behavior, not as an actual menu (no
 * items, no keyboard menu semantics needed). Used to keep dense grid cells
 * (class/exam timetable) readable at a glance, revealing secondary info —
 * a teacher's name, a venue — only when the cell is clicked.
 */
export function ClickReveal({
  trigger,
  children,
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className={cn("block w-full text-left", className)}>
          {trigger}
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 max-w-[220px] rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-foreground shadow-md"
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
