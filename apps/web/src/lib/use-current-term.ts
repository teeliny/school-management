import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
  isCurrent: boolean;
}

// GET /academic-sessions and /terms have no `isCurrent` filter (confirmed —
// only PATCH :id/set-current mutates it) — fetch and filter client-side,
// same shape as other client-side filtering already in this codebase.
// Extracted from my-schedule.tsx (BUILD_PLAN.md §9 Step 6c) since other
// "default to the current term" surfaces (the student profile's quick
// links, report-cards filters) need the exact same resolution.
//
// Backed by react-query so the ~10 dashboard organisms that all call this
// simultaneously share one in-flight request/cache instead of each firing
// their own GET /academic-sessions + GET /terms. staleTime is 5 min —
// academic-session-manager.tsx/term-manager.tsx invalidate the
// ["academic-sessions"]/["terms"] keys on every set-current/create/edit/
// delete mutation, so this doesn't mean a 5-minute-stale "current term".
export function useCurrentTerm() {
  const { data: sessions } = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: () => apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }),
    staleTime: 5 * 60_000,
  });
  const academicSessionId = sessions?.find((s) => s.isCurrent)?.id ?? "";

  const { data: terms } = useQuery({
    queryKey: ["terms", academicSessionId],
    queryFn: () => apiFetch<TermOption[]>(`/terms?academicSessionId=${academicSessionId}`, { auth: true }),
    enabled: Boolean(academicSessionId),
    staleTime: 5 * 60_000,
  });
  const termId = terms?.find((t) => t.isCurrent)?.id ?? "";

  return { academicSessionId, termId };
}
