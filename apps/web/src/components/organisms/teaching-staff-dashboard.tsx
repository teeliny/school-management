"use client";

import { useEffect, useState } from "react";
import type { ClassLevelCategory } from "@school/types";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { ProgressBar } from "../molecules/progress-bar";
import { Badge } from "../atoms/badge";
import { AttendanceRollCall } from "./attendance-roll-call";

interface StaffAssignmentItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  subjectId: string | null;
  classArm: { name: string; classLevel: { name: string; category: ClassLevelCategory } } | null;
  subject: { name: string } | null;
}
interface AssessmentComponentRow {
  id: string;
  name: string;
  classLevelCategory: ClassLevelCategory;
  inputClosesAt: string | null;
  status: string;
}
interface TimetableSlotItem {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  subject: { name: string };
  classArm: { displayName: string };
}
interface ScoreProgressRow {
  key: string;
  className: string;
  subjectName: string;
  componentName: string;
  totalStudents: number;
  enteredCount: number;
}

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAY_LABEL: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri" };

/**
 * PRD FR9.6 base table — the widget set every teaching StaffAssignment type
 * gets, regardless of assignmentType. CLASS_TEACHER/PRINCIPAL/HEADTEACHER/
 * REGISTRAR additions are separate organisms (BUILD_PLAN.md §10 Step 3),
 * composed alongside this one, not inside it. Renders null when this user
 * holds no StaffProfile at all, same "no empty-state clutter" pattern
 * MySchedule already established.
 */
export function TeachingStaffDashboard({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [assignments, setAssignments] = useState<StaffAssignmentItem[] | null>(null);
  const [openComponents, setOpenComponents] = useState<AssessmentComponentRow[] | null>(null);
  const [scoreProgress, setScoreProgress] = useState<ScoreProgressRow[] | null>(null);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlotItem[] | null>(null);
  const [backdateWindowDays, setBackdateWindowDays] = useState(3);

  useEffect(() => {
    if (!user.staffProfileId) return;
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setAssignments)
      .catch(() => setAssignments([]));
  }, [user.staffProfileId]);

  useEffect(() => {
    if (!termId) return;
    apiFetch<AssessmentComponentRow[]>(`/assessment-components?termId=${termId}`, { auth: true })
      .then(setOpenComponents)
      .catch(() => setOpenComponents([]));
  }, [termId]);

  useEffect(() => {
    apiFetch<{ attendanceBackdateWindowDays: number }>("/school-profile", { auth: true })
      .then((profile) => setBackdateWindowDays(profile.attendanceBackdateWindowDays))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user.staffProfileId || !academicSessionId || !termId) return;
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?staffId=${user.staffProfileId}&academicSessionId=${academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then(setTimetableSlots)
      .catch(() => setTimetableSlots([]));
  }, [user.staffProfileId, academicSessionId, termId]);

  useEffect(() => {
    if (!assignments || !openComponents) return;
    const subjectTeacherAssignments = assignments.filter(
      (a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive && a.classArmId && a.subjectId && a.classArm && a.subject,
    );

    Promise.all(
      subjectTeacherAssignments.flatMap((a) => {
        const relevant = openComponents.filter((c) => c.status === "OPEN" && c.classLevelCategory === a.classArm!.classLevel.category);
        return relevant.map(async (component): Promise<ScoreProgressRow | null> => {
          const summary = await apiFetch<{ totalStudents: number; enteredCount: number }>(
            `/score-entries/summary?classArmId=${a.classArmId}&subjectId=${a.subjectId}&assessmentComponentId=${component.id}`,
            { auth: true },
          ).catch(() => null);
          if (!summary) return null;
          return {
            key: `${a.classArmId}-${a.subjectId}-${component.id}`,
            className: `${a.classArm!.classLevel.name} ${a.classArm!.name}`,
            subjectName: a.subject!.name,
            componentName: component.name,
            totalStudents: summary.totalStudents,
            enteredCount: summary.enteredCount,
          };
        });
      }),
    ).then((rows) => setScoreProgress(rows.filter((r): r is ScoreProgressRow => r !== null)));
  }, [assignments, openComponents]);

  if (!user.staffProfileId) return null;

  const classTeacherArms = (assignments ?? []).filter((a) => a.assignmentType === "CLASS_TEACHER" && a.isActive && a.classArm);
  const subjectTeacherRows = (assignments ?? []).filter((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive && a.classArm && a.subject);
  const openComponentsFiltered = (openComponents ?? []).filter((c) => c.status === "OPEN");
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="My classes & subjects" sub="Active assignments this term" />
        {assignments ? (
          classTeacherArms.length === 0 && subjectTeacherRows.length === 0 ? (
            <p className="text-sm text-muted">No active teaching assignments.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classTeacherArms.map((a) => (
                <Badge key={`ct-${a.classArmId}`} variant="info">
                  Class teacher · {a.classArm!.classLevel.name} {a.classArm!.name}
                </Badge>
              ))}
              {subjectTeacherRows.map((a) => (
                <Badge key={`st-${a.classArmId}-${a.subjectId}`} variant="muted">
                  {a.subject!.name} · {a.classArm!.classLevel.name} {a.classArm!.name}
                </Badge>
              ))}
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Assessment components open" sub="Score-entry windows currently open" />
        {openComponents ? (
          openComponentsFiltered.length === 0 ? (
            <p className="text-sm text-muted">Nothing open right now.</p>
          ) : (
            <div className="space-y-1.5">
              {openComponentsFiltered.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                  <span>
                    {c.name} <span className="text-muted">({c.classLevelCategory})</span>
                  </span>
                  <span className="font-mono text-muted">{formatCountdown(c.inputClosesAt)}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      {subjectTeacherRows.length > 0 && (
        <Card>
          <CardHeader title="Score entry progress" sub="My subjects, open components" />
          {scoreProgress ? (
            scoreProgress.length === 0 ? (
              <p className="text-sm text-muted">No open components for my subjects right now.</p>
            ) : (
              <div className="space-y-2">
                {scoreProgress.map((row) => (
                  <div key={row.key} className="text-[12.5px]">
                    <div className="mb-0.5 flex items-center justify-between gap-2 text-muted">
                      <span>
                        {row.className} · {row.subjectName} · {row.componentName}
                      </span>
                      <span className="font-mono">
                        {row.enteredCount}/{row.totalStudents}
                      </span>
                    </div>
                    <ProgressBar value={row.totalStudents > 0 ? (row.enteredCount / row.totalStudents) * 100 : 0} size="sm" />
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Upcoming timetable" sub="This term's approved teaching slots" />
        {timetableSlots ? <WeeklyTimetableGrid slots={timetableSlots} /> : <p className="text-sm text-muted">Loading…</p>}
      </Card>

      {classTeacherArms.length > 0 && (
        <Card>
          <CardHeader title="Attendance to mark today" sub="Your class(es)' daily roll call" />
          <div className="space-y-4">
            {classTeacherArms.map((a) => (
              <div key={a.classArmId}>
                <div className="mb-1.5 text-[12.5px] font-medium">
                  {a.classArm!.classLevel.name} {a.classArm!.name}
                </div>
                <AttendanceRollCall mode="STUDENT_DAILY" classArmId={a.classArmId!} date={todayIso} backdateWindowDays={backdateWindowDays} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function WeeklyTimetableGrid({ slots }: { slots: TimetableSlotItem[] }) {
  const times = [...new Set(slots.map((s) => s.startTime))].sort();
  if (times.length === 0) return <p className="text-sm text-muted">No teaching slots this term.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr>
            <th className="w-16 p-1" />
            {DAYS.map((day) => (
              <th key={day} className="p-1 text-center text-[11px] uppercase tracking-wide text-muted">
                {DAY_LABEL[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time} className="border-t border-border">
              <td className="p-1 font-mono text-muted">{time}</td>
              {DAYS.map((day) => {
                const slot = slots.find((s) => s.dayOfWeek === day && s.startTime === time);
                return (
                  <td key={day} className="p-1 text-center">
                    {slot && (
                      <div className="rounded bg-card-inset px-1.5 py-1">
                        <div className="font-medium">{slot.subject.name}</div>
                        <div className="text-muted">{slot.classArm.displayName}</div>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCountdown(closesAt: string | null): string {
  if (!closesAt) return "No close date";
  const diffMs = new Date(closesAt).getTime() - Date.now();
  if (diffMs <= 0) return "Closed";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  return `${hours}h left`;
}
