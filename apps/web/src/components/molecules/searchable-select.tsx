"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Input } from "../atoms/input";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/**
 * Single-select dropdown with a search box filtering its (already-provided)
 * `options` client-side — built on Radix DropdownMenu the same way
 * `MultiSelect` is, since Radix's own `Select` primitive has no search slot
 * and `@radix-ui/react-popover` isn't a dependency. For small, already-fetched
 * option lists (e.g. a subject catalogue) — not for large, server-searched
 * ones (see `StudentCombobox` for that case).
 */
export function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <DropdownMenuPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
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
          <span className={cn("truncate", !selectedLabel && "text-muted")}>{selectedLabel ?? placeholder}</span>
          <ChevronDown className="h-4 w-4 flex-none text-muted" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[220px] rounded-lg border border-border bg-card text-foreground shadow-md"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={searchPlaceholder}
              className="h-8 pl-8 text-[12.5px]"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1">
            {filtered.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted">No matches</p>}
            {filtered.map((option) => {
              const checked = option.value === value;
              return (
                <DropdownMenuPrimitive.Item
                  key={option.value}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded py-1.5 pl-8 pr-2 text-sm outline-none",
                    "focus:bg-primary focus:text-primary-foreground",
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {checked && <Check className="h-4 w-4" />}
                  </span>
                  {option.label}
                </DropdownMenuPrimitive.Item>
              );
            })}
          </div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
