import { useEffect, useState } from "react";
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
export function useCurrentTerm() {
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [termId, setTermId] = useState("");

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then((sessions) => {
        const current = sessions.find((s) => s.isCurrent);
        if (current) setAcademicSessionId(current.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!academicSessionId) return;
    apiFetch<TermOption[]>(`/terms?academicSessionId=${academicSessionId}`, { auth: true })
      .then((terms) => {
        const current = terms.find((t) => t.isCurrent);
        if (current) setTermId(current.id);
      })
      .catch(() => {});
  }, [academicSessionId]);

  return { academicSessionId, termId };
}
