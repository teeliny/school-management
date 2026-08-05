"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

export interface MultiSelectOption {
  value: string;
  label: string;
}

// A dropdown multi-select — Radix's Select primitive is single-value only,
// so this is built on DropdownMenu + CheckboxItem instead (same underlying
// package as the DropdownMenu molecule), styled to match Select's trigger/
// content/item look. `onSelect` on each item is prevented so picking one
// option doesn't close the menu — the whole point of a multi-select.
export function MultiSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
}: {
  id?: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  className?: string;
}) {
  function toggle(optionValue: string) {
    onValueChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  }

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-border bg-card-inset px-3 py-2.5 text-left text-[13px] text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-muted",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", selectedLabels.length === 0 && "text-muted")}>
            {selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 flex-none text-muted" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[160px] overflow-auto rounded-lg border border-border bg-card p-1 text-foreground shadow-md"
        >
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <DropdownMenuPrimitive.CheckboxItem
                key={option.value}
                checked={checked}
                onCheckedChange={() => toggle(option.value)}
                onSelect={(e) => e.preventDefault()}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded py-1.5 pl-8 pr-2 text-sm outline-none",
                  "focus:bg-primary focus:text-primary-foreground",
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </DropdownMenuPrimitive.ItemIndicator>
                </span>
                {option.label}
              </DropdownMenuPrimitive.CheckboxItem>
            );
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
