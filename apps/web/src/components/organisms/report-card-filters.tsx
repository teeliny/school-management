"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { StudentCombobox } from "../molecules/student-combobox";

export const REPORT_CARD_FILTER_ALL = "__all__";

interface ClassArmOption {
  id: string;
  displayName: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface TermOption {
  id: string;
  name: string;
  isCurrent: boolean;
}

/**
 * Filter controls for the admin-tier "browse everything" Report Cards card
 * (SUPER_ADMIN/ADMIN/REGISTRAR/PRINCIPAL/HEADTEACHER only — a regular
 * teacher's or a parent's own report-card views live in
 * staff-report-card-section.tsx / parent-report-card-section.tsx instead,
 * each with a picker scoped to just their own classes/wards, never the whole
 * school). Owns fetching academic sessions/terms (session narrows term,
 * defaulting to whichever is `isCurrent`) so this admin-tier browse view can
 * look at a past session's reports, not just the current one. page.tsx keeps
 * owning the actual filter values via the setState setters passed in as
 * onChange props (stable identities, safe in effect deps).
 */
export function ReportCardFilters({
  classArms,
  classArmFilter,
  onClassArmFilterChange,
  studentFilter,
  onStudentFilterChange,
  termFilter,
  onTermFilterChange,
}: {
  classArms: ClassArmOption[];
  classArmFilter: string;
  onClassArmFilterChange: (value: string) => void;
  studentFilter: string;
  onStudentFilterChange: (value: string) => void;
  termFilter: string;
  onTermFilterChange: (value: string) => void;
}) {
  const [academicSessions, setAcademicSessions] = useState<AcademicSessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setAcademicSessions)
      .catch(() => setAcademicSessions([]));
  }, []);

  // Default to the current session on first load.
  useEffect(() => {
    if (sessionId || academicSessions.length === 0) return;
    setSessionId(academicSessions.find((s) => s.isCurrent)?.id ?? academicSessions[0]!.id);
  }, [academicSessions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setTerms([]);
      return;
    }
    apiFetch<TermOption[]>(`/terms?academicSessionId=${sessionId}`, { auth: true })
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [sessionId]);

  // Default to the current term within the newly-loaded session, if any —
  // only fires again when `terms` itself changes (i.e. the session changed),
  // so it never clobbers a term the user picked by hand within one session.
  useEffect(() => {
    if (terms.length === 0) return;
    onTermFilterChange(terms.find((t) => t.isCurrent)?.id ?? REPORT_CARD_FILTER_ALL);
  }, [terms, onTermFilterChange]);

  // Picking a class arm invalidates whichever student was selected under a
  // different (or no) arm — same "narrower filter clears the stale
  // selection" shape as the Generate panel's class-arm -> student reset in
  // page.tsx.
  useEffect(() => {
    onStudentFilterChange(REPORT_CARD_FILTER_ALL);
  }, [classArmFilter, onStudentFilterChange]);

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Label htmlFor="filter-class-arm">Class arm</Label>
        <Select value={classArmFilter} onValueChange={onClassArmFilterChange}>
          <SelectTrigger id="filter-class-arm" className="mt-1">
            <SelectValue placeholder="All class arms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={REPORT_CARD_FILTER_ALL}>All class arms</SelectItem>
            {classArms.map((arm) => (
              <SelectItem key={arm.id} value={arm.id}>
                {arm.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="filter-student">Student</Label>
        <StudentCombobox
          id="filter-student"
          classArmId={classArmFilter === REPORT_CARD_FILTER_ALL ? "" : classArmFilter}
          value={studentFilter === REPORT_CARD_FILTER_ALL ? "" : studentFilter}
          onValueChange={(id) => onStudentFilterChange(id)}
          placeholder="Search student…"
          className="mt-1"
        />
        {studentFilter !== REPORT_CARD_FILTER_ALL && (
          <button
            type="button"
            onClick={() => onStudentFilterChange(REPORT_CARD_FILTER_ALL)}
            className="mt-1 text-[11px] text-muted underline"
          >
            Clear student (show whole arm)
          </button>
        )}
      </div>

      <div>
        <Label htmlFor="filter-session">Academic session</Label>
        <Select value={sessionId} onValueChange={setSessionId}>
          <SelectTrigger id="filter-session" className="mt-1">
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {academicSessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="filter-term">Term</Label>
        <Select value={termFilter} onValueChange={onTermFilterChange}>
          <SelectTrigger id="filter-term" className="mt-1">
            <SelectValue placeholder="All terms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={REPORT_CARD_FILTER_ALL}>All terms</SelectItem>
            {terms.map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
