"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
interface ScoreProgressRow {
  key: string;
  className: string;
  subjectName: string;
  componentName: string;
  totalStudents: number;
  enteredCount: number;
}

/**
 * PRD FR9.6 base table — the widget set every teaching StaffAssignment type
 * gets, regardless of assignmentType. CLASS_TEACHER/PRINCIPAL/HEADTEACHER/
 * REGISTRAR additions are separate organisms (BUILD_PLAN.md §10 Step 3),
 * composed alongside this one, not inside it. Renders null when this user
 * holds no StaffProfile at all, same "no empty-state clutter" pattern
 * MySchedule already established.
 */
export function TeachingStaffDashboard({ user }: { user: CurrentUser }) {
  const { termId } = useCurrentTerm();
  const [scoreProgress, setScoreProgress] = useState<ScoreProgressRow[] | null>(null);
  const [backdateWindowDays, setBackdateWindowDays] = useState(3);

  const { data: assignments } = useQuery({
    queryKey: ["staff-assignments", "mine"],
    queryFn: () => apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true }),
    enabled: Boolean(user.staffProfileId),
  });
  const { data: openComponents } = useQuery({
    queryKey: ["assessment-components", termId],
    queryFn: () => apiFetch<AssessmentComponentRow[]>(`/assessment-components?termId=${termId}`, { auth: true }),
    enabled: Boolean(termId),
  });
  const { data: schoolProfile } = useQuery({
    queryKey: ["school-profile"],
    queryFn: () => apiFetch<{ attendanceBackdateWindowDays: number }>("/school-profile", { auth: true }),
  });
  useEffect(() => {
    if (schoolProfile) setBackdateWindowDays(schoolProfile.attendanceBackdateWindowDays);
  }, [schoolProfile]);
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

function formatCountdown(closesAt: string | null): string {
  if (!closesAt) return "No close date";
  const diffMs = new Date(closesAt).getTime() - Date.now();
  if (diffMs <= 0) return "Closed";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  return `${hours}h left`;
}
