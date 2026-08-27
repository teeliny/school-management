"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardHeader } from "../molecules/card";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { SearchableSelect } from "../molecules/searchable-select";
import { ReportCardList } from "./report-card-list";
import { REPORT_CARD_FILTER_ALL as ALL } from "./report-card-filters";

interface StudentOption {
  id: string;
  admissionNumber: string;
  status: string;
  user: { firstName: string; lastName: string };
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
 * "My children's report cards" — a parent's own view, entirely separate from
 * any staff/class-teacher browsing (see staff-report-card-section.tsx).
 * Fetches `/students/wards` directly (guardian-scoped, unconditional on the
 * caller's other roles) so a STAFF+PARENT user still sees just their own
 * child here, not their taught roster.
 */
export function ParentReportCardSection() {
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [studentId, setStudentId] = useState("");
  const [academicSessions, setAcademicSessions] = useState<AcademicSessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState(ALL);

  useEffect(() => {
    apiFetch<StudentOption[]>("/students/wards", { auth: true })
      .then(setStudents)
      .catch(() => setStudents([]));
  }, []);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setAcademicSessions)
      .catch(() => setAcademicSessions([]));
  }, []);

  // Default to whichever ward is still active, same precedent
  // dashboard/page.tsx's own child auto-select already uses.
  useEffect(() => {
    if (studentId || !students || students.length === 0) return;
    setStudentId((students.find((s) => s.status === "ACTIVE") ?? students[0])!.id);
  }, [students, studentId]);

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

  useEffect(() => {
    if (terms.length === 0) return;
    setTermId(terms.find((t) => t.isCurrent)?.id ?? ALL);
  }, [terms]);

  if (students && students.length === 0) return null;

  return (
    <Card>
      <CardHeader title="My children's report cards" />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {students && students.length > 1 && (
          <div>
            <Label htmlFor="ward-report-card-child">Child</Label>
            <SearchableSelect
              id="ward-report-card-child"
              value={studentId}
              onValueChange={setStudentId}
              options={students.map((s) => ({ value: s.id, label: studentOptionLabel(s) }))}
              placeholder="Select child"
              searchPlaceholder="Search by name or admission number…"
              className="mt-1"
            />
          </div>
        )}
        <div>
          <Label htmlFor="ward-report-card-session">Academic session</Label>
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger id="ward-report-card-session" className="mt-1">
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
          <Label htmlFor="ward-report-card-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="ward-report-card-term" className="mt-1">
              <SelectValue placeholder="All terms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All terms</SelectItem>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {studentId && (
        <ReportCardList
          studentId={studentId}
          termId={termId === ALL ? "" : termId}
          classArmId=""
          terms={terms}
          canManage={false}
          canDelete={false}
          refreshKey={0}
        />
      )}
    </Card>
  );
}
