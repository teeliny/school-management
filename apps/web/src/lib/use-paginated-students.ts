"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { useDebouncedValue } from "./use-debounced-value";

export interface PaginatedStudentItem {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}

interface StudentsPage {
  data: PaginatedStudentItem[];
  total: number;
}

const PAGE_SIZE = 25;

/**
 * Backend-paginated, backend-searched (name or admission number) student
 * list for one class arm — the shared data layer behind the gradebook and
 * all three Skills & Comments panels. `search` is debounced 300ms before it
 * triggers a request; changing `classArmId` or the debounced search resets
 * to the first page.
 */
export function usePaginatedStudents({
  classArmId,
  pageSize = PAGE_SIZE,
}: {
  classArmId: string;
  pageSize?: number;
}) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [students, setStudents] = useState<PaginatedStudentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an in-flight request from a superseded classArmId/search
  // resolving after a newer one and clobbering the list with stale data.
  const requestId = useRef(0);

  const loadPage = useCallback(
    (skip: number) => {
      if (!classArmId) return;
      const thisRequest = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ classArmId, skip: String(skip), take: String(pageSize) });
      if (search) params.set("search", search);
      apiFetch<StudentsPage>(`/students?${params.toString()}`, { auth: true })
        .then((res) => {
          if (thisRequest !== requestId.current) return;
          setStudents((prev) => (skip === 0 ? res.data : [...prev, ...res.data]));
          setTotal(res.total);
        })
        .catch((err) => {
          if (thisRequest !== requestId.current) return;
          setError(err instanceof ApiError ? err.message : "Failed to load students");
        })
        .finally(() => {
          if (thisRequest === requestId.current) setLoading(false);
        });
    },
    [classArmId, search, pageSize],
  );

  // A stale search term from the previous class arm would otherwise carry
  // over and silently scope the very first fetch for the new one.
  useEffect(() => {
    setSearchInput("");
  }, [classArmId]);

  useEffect(() => {
    setStudents([]);
    setTotal(0);
    if (!classArmId) return;
    loadPage(0);
  }, [classArmId, search, loadPage]);

  const loadMore = useCallback(() => {
    loadPage(students.length);
  }, [loadPage, students.length]);

  return {
    students,
    total,
    loading,
    error,
    hasMore: students.length < total,
    search: searchInput,
    setSearch: setSearchInput,
    loadMore,
    reload: () => loadPage(0),
  };
}
