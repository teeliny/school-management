"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { Input } from "../atoms/input";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { usePaginatedStudents } from "../../lib/use-paginated-students";

/**
 * Single-student picker backed by the server-searched, paginated
 * `/students` endpoint (via `usePaginatedStudents`) — unlike
 * `SearchableSelect`, which filters an already-fetched list client-side,
 * this is for the school-wide student list, which can be large. Search and
 * "scroll to load more" both happen inside the open popover.
 */
export function StudentCombobox({
  id,
  classArmId,
  value,
  onValueChange,
  placeholder = "Select student…",
  className,
}: {
  id?: string;
  classArmId: string;
  value: string;
  onValueChange: (studentId: string, label: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const { students, total, loading, error, hasMore, search, setSearch, loadMore } = usePaginatedStudents({
    classArmId,
  });
  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore, loading, root: null });

  // Clears the picked label whenever the caller resets `value` (e.g. the
  // class arm changed and the previous selection no longer applies).
  useEffect(() => {
    if (!value) setSelectedLabel("");
  }, [value]);

  return (
    <DropdownMenuPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={!classArmId}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-border bg-card-inset px-3 py-2.5 text-left text-[13px] text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-muted",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selectedLabel && "text-muted")}>
            {selectedLabel || (classArmId ? placeholder : "Select a class arm first")}
          </span>
          <ChevronDown className="h-4 w-4 flex-none text-muted" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[260px] rounded-lg border border-border bg-card text-foreground shadow-md"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search by name or admission number…"
              className="h-8 pl-8 text-[12.5px]"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1">
            {error && <p className="px-2 py-1.5 text-[12px] text-danger">{error}</p>}
            {!error && students.length === 0 && !loading && (
              <p className="px-2 py-1.5 text-[12px] text-muted">No students found</p>
            )}
            {students.map((student) => {
              const label = `${student.user.firstName} ${student.user.lastName} (${student.admissionNumber})`;
              const checked = student.id === value;
              return (
                <DropdownMenuPrimitive.Item
                  key={student.id}
                  onSelect={() => {
                    setSelectedLabel(label);
                    onValueChange(student.id, label);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded py-1.5 pl-8 pr-2 text-sm outline-none",
                    "focus:bg-primary focus:text-primary-foreground",
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {checked && <Check className="h-4 w-4" />}
                  </span>
                  {label}
                </DropdownMenuPrimitive.Item>
              );
            })}
            <div ref={sentinelRef} />
            {loading && <p className="px-2 py-1.5 text-center text-[11px] text-muted">Loading…</p>}
            {total > 0 && (
              <p className="px-2 py-1 text-[10.5px] text-muted">
                Showing {students.length} of {total}
              </p>
            )}
          </div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
