"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { ProgressBar } from "../molecules/progress-bar";
import { DonutChart, LineChart } from "../molecules/chart";
import { StatCard } from "../atoms/stat-card";

interface StaffAssignmentItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  classArm: { name: string; classLevel: { name: string } } | null;
}
interface RosterSummary {
  headcount: number;
  genderSplit: { male: number; female: number; other: number; unspecified: number };
}
interface SkillProgress {
  totalStudents: number;
  completedCount: number;
}
interface StudentListItem {
  id: string;
  user: { firstName: string; lastName: string };
}
interface ReportCommentItem {
  commentType: string;
}
interface AttendanceTrendPoint {
  date: string;
  percentage: number | null;
}

/**
 * PRD FR9.6 CLASS_TEACHER additions — composed alongside TeachingStaffDashboard,
 * not inside it (BUILD_PLAN.md §10 Step 3). Self-fetches its own active
 * CLASS_TEACHER assignments rather than taking them as a prop, matching the
 * "each organism fetches its own data" convention every other dashboard
 * widget here follows. Renders one section per class arm the caller is the
 * active class teacher of (usually exactly one).
 */
export function ClassTeacherAdditions({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const { data: assignments } = useQuery({
    queryKey: ["staff-assignments", "mine"],
    queryFn: () => apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true }),
    enabled: Boolean(user.staffProfileId),
  });

  if (!user.staffProfileId) return null;

  const classArms = (assignments ?? []).filter((a) => a.assignmentType === "CLASS_TEACHER" && a.isActive && a.classArm && a.classArmId);
  if (classArms.length === 0) return null;
  if (!academicSessionId || !termId) return null;

  return (
    <div className="mt-4 space-y-4">
      {classArms.map((a) => (
        <ClassTeacherSection
          key={a.classArmId}
          classArmId={a.classArmId!}
          className={`${a.classArm!.classLevel.name} ${a.classArm!.name}`}
          academicSessionId={academicSessionId}
          termId={termId}
        />
      ))}
    </div>
  );
}

function ClassTeacherSection({
  classArmId,
  className,
  academicSessionId,
  termId,
}: {
  classArmId: string;
  className: string;
  academicSessionId: string;
  termId: string;
}) {
  const [missingComments, setMissingComments] = useState<string[] | null>(null);

  const { data: roster } = useQuery({
    queryKey: ["dashboard", "class-roster-summary", classArmId],
    queryFn: () => apiFetch<RosterSummary>(`/dashboard/class-roster-summary?classArmId=${classArmId}`, { auth: true }),
  });
  const { data: skillProgress } = useQuery({
    queryKey: ["skill-ratings-progress", classArmId, academicSessionId, termId],
    queryFn: () =>
      apiFetch<SkillProgress>(
        `/skill-ratings/progress?classArmId=${classArmId}&termId=${termId}&academicSessionId=${academicSessionId}`,
        { auth: true },
      ),
  });
  const { data: attendanceInsights } = useQuery({
    queryKey: ["dashboard", "attendance-insights", termId, classArmId],
    queryFn: () =>
      apiFetch<{ dailyTrend: AttendanceTrendPoint[] }>(
        `/dashboard/attendance-insights?termId=${termId}&classArmId=${classArmId}`,
        { auth: true },
      ),
  });
  const attendanceTrend = attendanceInsights?.dailyTrend ?? null;

  useEffect(() => {
    apiFetch<StudentListItem[]>(`/students?classArmId=${classArmId}`, { auth: true })
      .then(async (students) => {
        const results = await Promise.all(
          students.map(async (student) => {
            const comments = await apiFetch<ReportCommentItem[]>(
              `/report-comments?studentId=${student.id}&termId=${termId}`,
              { auth: true },
            ).catch(() => []);
            const hasClassTeacherComment = comments.some((c) => c.commentType === "CLASS_TEACHER");
            return hasClassTeacherComment ? null : `${student.user.firstName} ${student.user.lastName}`;
          }),
        );
        setMissingComments(results.filter((name): name is string => name !== null));
      })
      .catch(() => setMissingComments([]));
  }, [classArmId, termId]);

  return (
    <Card>
      <CardHeader title={`Class teacher — ${className}`} sub="Your class's status this term" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          {roster && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Class roster" value={roster.headcount} />
              <div className="rounded-card border border-border px-4 py-3.5">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Gender split</div>
                <DonutChart
                  data={[
                    { label: "Male", value: roster.genderSplit.male },
                    { label: "Female", value: roster.genderSplit.female },
                  ].filter((d) => d.value > 0)}
                  height={100}
                />
              </div>
            </div>
          )}
          {skillProgress && (
            <ProgressBar
              value={skillProgress.totalStudents > 0 ? (skillProgress.completedCount / skillProgress.totalStudents) * 100 : 0}
              label="Skill/report ratings completed"
            />
          )}
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Comments outstanding</div>
            {missingComments ? (
              missingComments.length === 0 ? (
                <p className="text-[12.5px] text-muted">Every student has a class-teacher comment.</p>
              ) : (
                <ul className="max-h-[140px] space-y-1 overflow-y-auto text-[12.5px]">
                  {missingComments.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )
            ) : (
              <p className="text-[12.5px] text-muted">Loading…</p>
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Class attendance, daily %</div>
          {attendanceTrend && attendanceTrend.length > 0 ? (
            <LineChart data={attendanceTrend as unknown as Record<string, string | number>[]} xKey="date" yKey="percentage" height={160} />
          ) : (
            <p className="text-[12.5px] text-muted">No attendance recorded yet this term.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
