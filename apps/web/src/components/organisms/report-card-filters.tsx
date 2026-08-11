"use client";

import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { SearchableSelect } from "../molecules/searchable-select";
import { StudentCombobox } from "../molecules/student-combobox";

export const REPORT_CARD_FILTER_ALL = "__all__";

interface StudentOption {
  id: string;
  admissionNumber: string;
  status: string;
  user: { firstName: string; lastName: string };
}
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

function studentOptionLabel(student: StudentOption) {
  return `${student.user.firstName} ${student.user.lastName} (${student.admissionNumber})`;
}

/**
 * Filter controls for the Report Cards page. Owns fetching academic
 * sessions/terms (session narrows term, defaulting to whichever is
 * `isCurrent`) so any role can browse a past session's reports, not just the
 * current one. Branches on PARENT: never fetches/renders the class-arm
 * filter (not meaningful to a parent, and `/class-arms` isn't role-scoped),
 * and auto-selects the student filter — hidden entirely for a single ward,
 * defaulting to whichever ward is still ACTIVE when there are several.
 * page.tsx keeps owning the actual filter values via the setState setters
 * passed in as onChange props (stable identities, safe in effect deps).
 */
export function ReportCardFilters({
  students,
  classArms,
  user,
  classArmFilter,
  onClassArmFilterChange,
  studentFilter,
  onStudentFilterChange,
  termFilter,
  onTermFilterChange,
}: {
  students: StudentOption[];
  classArms: ClassArmOption[];
  user: CurrentUser;
  classArmFilter: string;
  onClassArmFilterChange: (value: string) => void;
  studentFilter: string;
  onStudentFilterChange: (value: string) => void;
  termFilter: string;
  onTermFilterChange: (value: string) => void;
}) {
  const isParent = user.roles.includes("PARENT");

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

  // PRD ask: a parent with one ward shouldn't need a picker at all; with
  // several, default to whichever is still active this academic year rather
  // than an arbitrary one. Runs once (guarded by the ref) so it doesn't
  // fight a manual re-selection later.
  const hasAutoSelectedStudent = useRef(false);
  useEffect(() => {
    if (!isParent || hasAutoSelectedStudent.current || students.length === 0) return;
    hasAutoSelectedStudent.current = true;
    const activeWard = students.find((s) => s.status === "ACTIVE");
    onStudentFilterChange(activeWard?.id ?? students[0]!.id);
  }, [isParent, students, onStudentFilterChange]);

  // Picking a class arm invalidates whichever student was selected under a
  // different (or no) arm — same "narrower filter clears the stale child
  // selection" shape as the Generate panel's class-arm -> student reset in
  // page.tsx, applied here so the picker never keeps a selection that no
  // longer belongs to the newly-chosen arm.
  useEffect(() => {
    if (isParent) return;
    onStudentFilterChange(REPORT_CARD_FILTER_ALL);
  }, [classArmFilter, isParent, onStudentFilterChange]);

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {!isParent && (
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
      )}

      {isParent && students.length > 1 && (
        <div>
          <Label htmlFor="filter-student">Child</Label>
          <SearchableSelect
            id="filter-student"
            value={studentFilter}
            onValueChange={onStudentFilterChange}
            options={students.map((student) => ({ value: student.id, label: studentOptionLabel(student) }))}
            placeholder="Select child"
            searchPlaceholder="Search by name or admission number…"
            className="mt-1"
          />
        </div>
      )}

      {!isParent && (
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
      )}

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
