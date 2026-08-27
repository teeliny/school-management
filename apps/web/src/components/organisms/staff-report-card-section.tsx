"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardHeader } from "../molecules/card";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { StudentCombobox } from "../molecules/student-combobox";
import { ReportCardList } from "./report-card-list";
import { REPORT_CARD_FILTER_ALL as ALL } from "./report-card-filters";

interface ClassArmOption {
  classArmId: string;
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
interface StaffAssignmentItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  classArm: { name: string; classLevel: { name: string } } | null;
}

/**
 * "My class report cards" — a class teacher's own homeroom view, entirely
 * separate from any parent/ward browsing (see parent-report-card-section.tsx).
 * Only rendered for a regular teacher (dashboard/report-cards page gates this
 * out for SUPER_ADMIN/ADMIN/REGISTRAR/PRINCIPAL/HEADTEACHER, who get the full
 * admin "browse everything" card instead). The class picker's option list is
 * her own active CLASS_TEACHER assignments only — never the whole school's
 * class arms, and never the classes she merely subject-teaches (PRD ask: a
 * class teacher should only see report cards for students in her own class).
 */
export function StaffReportCardSection() {
  const [classArms, setClassArms] = useState<ClassArmOption[] | null>(null);
  const [classArmId, setClassArmId] = useState("");
  const [studentId, setStudentId] = useState(ALL);
  const [academicSessions, setAcademicSessions] = useState<AcademicSessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState(ALL);

  useEffect(() => {
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then((assignments) => {
        const arms = assignments
          .filter((a) => a.assignmentType === "CLASS_TEACHER" && a.isActive && a.classArmId && a.classArm)
          .map((a) => ({ classArmId: a.classArmId!, displayName: `${a.classArm!.classLevel.name} ${a.classArm!.name}` }));
        setClassArms(arms);
      })
      .catch(() => setClassArms([]));
  }, []);

  useEffect(() => {
    if (!classArmId && classArms && classArms[0]) setClassArmId(classArms[0].classArmId);
  }, [classArms, classArmId]);

  // A different homeroom invalidates whichever student was picked under the
  // previous one — same "narrower filter clears the stale selection" shape
  // used elsewhere on this page.
  useEffect(() => {
    setStudentId(ALL);
  }, [classArmId]);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setAcademicSessions)
      .catch(() => setAcademicSessions([]));
  }, []);

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

  if (classArms && classArms.length === 0) return null;

  return (
    <Card>
      <CardHeader title="My class report cards" />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {classArms && classArms.length > 1 && (
          <div>
            <Label htmlFor="staff-report-card-class">Class</Label>
            <Select value={classArmId} onValueChange={setClassArmId}>
              <SelectTrigger id="staff-report-card-class" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classArms.map((c) => (
                  <SelectItem key={c.classArmId} value={c.classArmId}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="staff-report-card-student">Student</Label>
          <StudentCombobox
            id="staff-report-card-student"
            classArmId={classArmId}
            value={studentId === ALL ? "" : studentId}
            onValueChange={(id) => setStudentId(id || ALL)}
            placeholder="Search student…"
            className="mt-1"
          />
          {studentId !== ALL && (
            <button type="button" onClick={() => setStudentId(ALL)} className="mt-1 text-[11px] text-muted underline">
              Clear student (show whole class)
            </button>
          )}
        </div>
        <div>
          <Label htmlFor="staff-report-card-session">Academic session</Label>
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger id="staff-report-card-session" className="mt-1">
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
          <Label htmlFor="staff-report-card-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="staff-report-card-term" className="mt-1">
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

      {classArmId && (
        <ReportCardList
          studentId={studentId === ALL ? "" : studentId}
          termId={termId === ALL ? "" : termId}
          classArmId={classArmId}
          terms={terms}
          canManage={false}
          canDelete={false}
          refreshKey={0}
        />
      )}
    </Card>
  );
}
