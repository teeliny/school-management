"use client";

import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "../atoms/input";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";

/**
 * Search box + scrollable, infinite-loading shell — the shared wrapper for
 * the gradebook and all three Skills & Comments panels. Each caller renders
 * its own list markup as `children` (a `<table>` for the gradebook, mapped
 * `<div>` cards for the comment panels) — this component only owns the
 * fetch-more/search/empty/loading mechanics around it, via the sentinel div
 * it appends after `children` inside the scroll container.
 */
export function PaginatedStudentList({
  studentCount,
  total,
  loading,
  error,
  hasMore,
  search,
  onSearchChange,
  onLoadMore,
  children,
  searchPlaceholder = "Search by name or admission number…",
  emptyMessage = "No students in this class arm.",
  className = "max-h-[420px] overflow-auto",
}: {
  studentCount: number;
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onLoadMore: () => void;
  children: ReactNode;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const sentinelRef = useInfiniteScroll({ onLoadMore, hasMore, loading });

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!error && studentCount === 0 && !loading && <p className="text-sm text-muted">{emptyMessage}</p>}

      {studentCount > 0 && (
        <div className={className}>
          {children}
          <div ref={sentinelRef} />
          {loading && <p className="py-2 text-center text-[11.5px] text-muted">Loading…</p>}
        </div>
      )}

      {studentCount === 0 && loading && <p className="text-sm text-muted">Loading…</p>}

      {total > 0 && (
        <p className="text-[11px] text-muted">
          Showing {studentCount} of {total}
        </p>
      )}
    </div>
  );
}
