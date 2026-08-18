"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { useDebouncedValue } from "./use-debounced-value";

export interface PaginatedStudentItem {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  currentClass: { name: string; classLevel: { name: string } } | null;
  user: { firstName: string; lastName: string };
}

interface StudentsPage {
  data: PaginatedStudentItem[];
  total: number;
}

const PAGE_SIZE = 25;

/**
 * Backend-paginated, backend-searched (name or admission number) student
 * list, scoped to one class arm (`classArmId`, the gradebook/Skills &
 * Comments panels' shape) or a whole class-level category (`classLevelCategory`,
 * e.g. SSS-only for department assignment) — exactly one should be passed.
 * `search` is debounced 300ms before it triggers a request; changing the
 * scope or the debounced search resets to the first page.
 */
export function usePaginatedStudents({
  classArmId,
  classLevelCategory,
  pageSize = PAGE_SIZE,
}: {
  classArmId?: string;
  classLevelCategory?: string;
  pageSize?: number;
}) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [students, setStudents] = useState<PaginatedStudentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an in-flight request from a superseded scope/search
  // resolving after a newer one and clobbering the list with stale data.
  const requestId = useRef(0);
  const scoped = Boolean(classArmId || classLevelCategory);

  const loadPage = useCallback(
    (skip: number) => {
      if (!scoped) return;
      const thisRequest = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ skip: String(skip), take: String(pageSize) });
      if (classArmId) params.set("classArmId", classArmId);
      if (classLevelCategory) params.set("classLevelCategory", classLevelCategory);
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
    [scoped, classArmId, classLevelCategory, search, pageSize],
  );

  // A stale search term from the previous scope would otherwise carry over
  // and silently scope the very first fetch for the new one.
  useEffect(() => {
    setSearchInput("");
  }, [classArmId, classLevelCategory]);

  useEffect(() => {
    setStudents([]);
    setTotal(0);
    if (!scoped) return;
    loadPage(0);
  }, [scoped, classArmId, classLevelCategory, search, loadPage]);

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
