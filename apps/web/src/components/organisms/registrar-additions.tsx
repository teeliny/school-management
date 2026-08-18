"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { BarChart, LineChart } from "../molecules/chart";
import { Button } from "../atoms/button";
import { AllClassesTimetableView } from "./all-classes-timetable-view";

interface AttendanceOverview {
  byClass: { classArmId: string; className: string; percentageToday: number | null }[];
  schoolDailyTrend: { date: string; percentage: number | null }[];
}

/** PRD FR9.6 REGISTRAR additions. */
export function RegistrarAdditions({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [attendance, setAttendance] = useState<AttendanceOverview | null>(null);

  const isRegistrar = user.assignmentTypes.includes("REGISTRAR");

  useEffect(() => {
    if (!termId || !isRegistrar) return;
    apiFetch<AttendanceOverview>(`/dashboard/attendance-insights?termId=${termId}`, { auth: true })
      .then(setAttendance)
      .catch(() => setAttendance(null));
  }, [termId, isRegistrar]);

  if (!isRegistrar) return null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="Whole-school attendance analytics" sub="Today's % by class, and the school-wide trend" />
        {attendance ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">By class, today</div>
              <BarChart
                data={attendance.byClass.map((c) => ({ className: c.className, percentageToday: c.percentageToday ?? 0 }))}
                xKey="className"
                yKey="percentageToday"
                height={200}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">School-wide, over the term</div>
              {attendance.schoolDailyTrend.length > 0 ? (
                <LineChart
                  data={attendance.schoolDailyTrend as unknown as Record<string, string | number>[]}
                  xKey="date"
                  yKey="percentage"
                  height={200}
                />
              ) : (
                <p className="text-[12.5px] text-muted">No attendance recorded yet this term.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Timetable overview" sub="Every class, this term" />
        {academicSessionId && termId ? (
          <AllClassesTimetableView academicSessionId={academicSessionId} termId={termId} onViewClass={() => {}} />
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Schedule generation triggers" sub="Kick off a new AI-assisted generation run" />
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href="/planner">Trigger generation</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
