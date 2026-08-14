"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { Card, CardHeader } from "../molecules/card";
import { ReadOnlyScheduleTable } from "../molecules/read-only-schedule-table";
import { TimetableGrid } from "./timetable-grid";

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
interface StudentRecord {
  id: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface ExamScheduleItem {
  id: string;
  subject: { name: string };
  date: string;
  startTime: string;
  endTime: string;
}
interface TimetableSlotItem {
  id: string;
  subject: { name: string };
  classArm: { displayName: string };
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  venue: string | null;
}
interface InvigilationAssignmentItem {
  id: string;
  role: string;
  examSchedule: { subject: { name: string }; classArm: { displayName: string }; date: string };
}
interface DutyAssignmentItem {
  id: string;
  weekStartDate: string;
  classLevelCategoryGroup: string;
}

// GET /academic-sessions and /terms have no `isCurrent` filter (confirmed —
// only PATCH :id/set-current mutates it) — fetch and filter client-side,
// same shape as other client-side filtering already in this codebase.
function useCurrentTerm() {
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

/**
 * BUILD_PLAN.md §9 Step 6c: "My schedule" on /dashboard — a personal,
 * pre-filtered view of a student/parent/staff member's own schedule.
 * `/planner` (formerly `/scheduling`) is now visible to every authenticated
 * user too, per the same underlying read endpoints, for anyone who wants to
 * browse beyond just their own rows. Reuses the four GET endpoints Step 6
 * already built, which default to APPROVED-only with no extra auth gate —
 * no backend permission change needed, only the "whose scope is this" resolution
 * (staffProfileId/studentProfileId/parentProfileId, now on /auth/me).
 * Renders nothing when there's nothing relevant to show (e.g. a pure Admin
 * with no staff profile) — no empty-state clutter on every dashboard.
 */
export function MySchedule({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [children, setChildren] = useState<StudentRecord[] | null>(null);

  useEffect(() => {
    if (!user.studentProfileId && !user.parentProfileId) return;
    apiFetch<StudentRecord[]>("/students", { auth: true })
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [user.studentProfileId, user.parentProfileId]);

  const hasAnyScope = Boolean(user.studentProfileId || user.parentProfileId || user.staffProfileId);
  if (!hasAnyScope) return null;
  if (!academicSessionId || !termId) return null;

  return (
    <Card className="mt-4">
      <CardHeader title="My schedule" sub="This term's approved schedule" />
      <div className="space-y-5">
        {user.studentProfileId && children && children[0] && (
          <StudentScheduleSection classArmId={children[0].currentClassId} academicSessionId={academicSessionId} termId={termId} />
        )}
        {user.parentProfileId &&
          children &&
          children.map((child) => (
            <div key={child.id}>
              <div className="mb-1.5 text-[12.5px] font-medium">
                {child.user.firstName} {child.user.lastName}
              </div>
              <StudentScheduleSection classArmId={child.currentClassId} academicSessionId={academicSessionId} termId={termId} />
            </div>
          ))}
        {user.staffProfileId && (
          <StaffScheduleSection staffId={user.staffProfileId} academicSessionId={academicSessionId} termId={termId} />
        )}
      </div>
    </Card>
  );
}

function StudentScheduleSection({
  classArmId,
  academicSessionId,
  termId,
}: {
  classArmId: string | null;
  academicSessionId: string;
  termId: string;
}) {
  const [examSchedules, setExamSchedules] = useState<ExamScheduleItem[]>([]);

  useEffect(() => {
    if (!classArmId) return;
    apiFetch<ExamScheduleItem[]>(`/exam-schedules?classArmId=${classArmId}`, { auth: true })
      .then(setExamSchedules)
      .catch(() => setExamSchedules([]));
  }, [classArmId]);

  if (!classArmId) return <p className="text-[12px] text-muted">No class assigned yet.</p>;

  return (
    <div className="space-y-3">
      <TimetableGrid classArmId={classArmId} academicSessionId={academicSessionId} termId={termId} canManage={false} />
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Exam schedule</div>
        <ReadOnlyScheduleTable
          headers={["Subject", "Date", "Time"]}
          rows={examSchedules.map((e) => ({
            id: e.id,
            cells: [e.subject.name, new Date(e.date).toLocaleDateString(), `${e.startTime}–${e.endTime}`],
          }))}
          emptyMessage="No exam schedule published yet."
        />
      </div>
    </div>
  );
}

function StaffScheduleSection({
  staffId,
  academicSessionId,
  termId,
}: {
  staffId: string;
  academicSessionId: string;
  termId: string;
}) {
  const [slots, setSlots] = useState<TimetableSlotItem[]>([]);
  const [invigilations, setInvigilations] = useState<InvigilationAssignmentItem[]>([]);
  const [duties, setDuties] = useState<DutyAssignmentItem[]>([]);

  useEffect(() => {
    apiFetch<TimetableSlotItem[]>(`/timetable-slots?staffId=${staffId}&academicSessionId=${academicSessionId}&termId=${termId}`, {
      auth: true,
    })
      .then(setSlots)
      .catch(() => setSlots([]));
    apiFetch<InvigilationAssignmentItem[]>(`/invigilation-assignments?staffId=${staffId}`, { auth: true })
      .then(setInvigilations)
      .catch(() => setInvigilations([]));
    apiFetch<DutyAssignmentItem[]>(`/duty-assignments?staffId=${staffId}`, { auth: true })
      .then(setDuties)
      .catch(() => setDuties([]));
  }, [staffId, academicSessionId, termId]);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">My teaching schedule</div>
        <ReadOnlyScheduleTable
          headers={["Day", "Time", "Subject", "Class", "Venue"]}
          rows={slots.map((s) => ({
            id: s.id,
            cells: [s.dayOfWeek, `${s.startTime}–${s.endTime}`, s.subject.name, s.classArm.displayName, s.venue ?? "—"],
          }))}
          emptyMessage="No teaching slots this term."
        />
      </div>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">My invigilation duty</div>
        <ReadOnlyScheduleTable
          headers={["Role", "Subject", "Class", "Date"]}
          rows={invigilations.map((i) => ({
            id: i.id,
            cells: [i.role, i.examSchedule.subject.name, i.examSchedule.classArm.displayName, new Date(i.examSchedule.date).toLocaleDateString()],
          }))}
          emptyMessage="No invigilation duty assigned."
        />
      </div>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">My weekly duty</div>
        <ReadOnlyScheduleTable
          headers={["Week", "Group"]}
          rows={duties.map((d) => ({
            id: d.id,
            cells: [`week of ${new Date(d.weekStartDate).toLocaleDateString()}`, d.classLevelCategoryGroup],
          }))}
          emptyMessage="No weekly duty assigned."
        />
      </div>
    </div>
  );
}
