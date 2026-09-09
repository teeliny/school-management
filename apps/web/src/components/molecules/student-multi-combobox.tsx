"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { Input } from "../atoms/input";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { usePaginatedStudents } from "../../lib/use-paginated-students";

/**
 * Multi-student picker backed by the same server-searched, paginated
 * `/students` endpoint as `StudentCombobox`, but lets the caller check off
 * more than one student before closing the menu — Radix DropdownMenu +
 * CheckboxItem with `onSelect` prevented so picking one doesn't close the
 * popover, same pattern as the `MultiSelect` molecule. Search and "scroll
 * to load more" both happen inside the open popover, same as
 * `StudentCombobox`.
 *
 * Scope with exactly one of `classArmId` or `classLevelCategory`, same as
 * `StudentCombobox`. Students load a page at a time, so a picked student's
 * label is cached locally (`labelById`) — otherwise the trigger would lose
 * their name once that page scrolls out or a search narrows the list.
 */
export function StudentMultiCombobox({
  id,
  classArmId,
  classLevelCategory,
  value,
  onValueChange,
  placeholder = "Select students…",
  extraLabelsByStudentId,
  className,
}: {
  id?: string;
  classArmId?: string;
  classLevelCategory?: string;
  value: string[];
  onValueChange: (studentIds: string[], labels: string[]) => void;
  placeholder?: string;
  extraLabelsByStudentId?: Record<string, string>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [labelById, setLabelById] = useState<Record<string, string>>({});
  const { students, total, loading, error, hasMore, search, setSearch, loadMore } = usePaginatedStudents({
    classArmId,
    classLevelCategory,
  });
  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore, loading, root: null });
  const scoped = Boolean(classArmId || classLevelCategory);

  function toggle(studentId: string, label: string) {
    const nextLabelById = { ...labelById, [studentId]: label };
    setLabelById(nextLabelById);
    const nextIds = value.includes(studentId) ? value.filter((v) => v !== studentId) : [...value, studentId];
    onValueChange(
      nextIds,
      nextIds.map((v) => nextLabelById[v] ?? v),
    );
  }

  const selectedLabels = value.map((studentId) => labelById[studentId] ?? studentId);

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
          disabled={!scoped}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-border bg-card-inset px-3 py-2.5 text-left text-[13px] text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-muted",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", selectedLabels.length === 0 && "text-muted")}>
            {selectedLabels.length > 0
              ? `${selectedLabels.length} selected: ${selectedLabels.join(", ")}`
              : scoped
                ? placeholder
                : "Select a class arm first"}
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
              let label = `${student.user.firstName} ${student.user.lastName} (${student.admissionNumber})`;
              if (!classArmId && student.currentClass) {
                label += ` — ${student.currentClass.classLevel.name} ${student.currentClass.name}`;
              }
              const extra = extraLabelsByStudentId?.[student.id];
              if (extra) label += ` — ${extra}`;
              const checked = value.includes(student.id);
              return (
                <DropdownMenuPrimitive.CheckboxItem
                  key={student.id}
                  checked={checked}
                  onCheckedChange={() => toggle(student.id, label)}
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
                  {label}
                </DropdownMenuPrimitive.CheckboxItem>
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
