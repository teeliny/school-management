"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import type { ParentChild } from "../../lib/use-parent-children";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";

interface StudentRecord {
  id: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface TimetableSlotItem {
  id: string;
  subject: { name: string };
  classArm: { displayName: string };
  dayOfWeek: string;
  startTime: string;
}
interface StaffAssignmentItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  classArm: { name: string; classLevel: { name: string } } | null;
}

const TODAY_DAY_OF_WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][new Date().getDay()];

function todaySlotsOf(slots: TimetableSlotItem[]) {
  return slots.filter((s) => s.dayOfWeek === TODAY_DAY_OF_WEEK).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * Dashboard's "My schedule" card — deliberately just *today's* immediate
 * periods (not the full weekly grid; that's Planner's Class Timetable tab,
 * linked below). A hybrid user can hold several of these roles at once (e.g.
 * a class teacher who's also a parent), so each section carries a role tag
 * to keep straight which schedule belongs to which hat.
 */
export function MySchedule({ user, selectedChild }: { user: CurrentUser; selectedChild: ParentChild | null }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const hasAnyScope = Boolean(user.studentProfileId || user.parentProfileId || user.staffProfileId);

  if (!hasAnyScope) return null;
  if (!academicSessionId || !termId) return null;

  return (
    <Card className="mt-4">
      <CardHeader title="My schedule" sub="Today's immediate schedule" />
      <div className="space-y-4">
        {user.studentProfileId && <StudentToday academicSessionId={academicSessionId} termId={termId} />}
        {user.parentProfileId && selectedChild && (
          <WardToday child={selectedChild} academicSessionId={academicSessionId} termId={termId} />
        )}
        {user.staffProfileId && <StaffToday staffId={user.staffProfileId} academicSessionId={academicSessionId} termId={termId} />}
      </div>
      <div className="mt-3">
        <Button asChild size="sm" variant="outline">
          <Link href="/planner?tab=class-timetable">View full schedule</Link>
        </Button>
      </div>
    </Card>
  );
}

function RoleTag({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <Badge variant={variant} className="mb-1.5">
      {label}
    </Badge>
  );
}

function TodayList({ slots, showClass }: { slots: TimetableSlotItem[]; showClass?: boolean }) {
  if (slots.length === 0) return <p className="text-[12.5px] text-muted">No classes today.</p>;
  return (
    <ul className="space-y-1 text-[12.5px]">
      {slots.map((s) => (
        <li key={s.id} className="flex justify-between gap-3">
          <span>
            {s.subject.name}
            {showClass && <span className="text-muted"> · {s.classArm.displayName}</span>}
          </span>
          <span className="font-mono text-muted">{s.startTime}</span>
        </li>
      ))}
    </ul>
  );
}

function StudentToday({ academicSessionId, termId }: { academicSessionId: string; termId: string }) {
  const { data: children } = useQuery({
    queryKey: ["students"],
    queryFn: () => apiFetch<StudentRecord[]>("/students", { auth: true }),
  });
  const classArmId = children?.[0]?.currentClassId ?? null;
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);

  useEffect(() => {
    if (!classArmId) return;
    apiFetch<TimetableSlotItem[]>(`/timetable-slots?classArmId=${classArmId}&academicSessionId=${academicSessionId}&termId=${termId}`, {
      auth: true,
    })
      .then((all) => setSlots(todaySlotsOf(all)))
      .catch(() => setSlots([]));
  }, [classArmId, academicSessionId, termId]);

  return (
    <div>
      <RoleTag label="Student" variant="info" />
      {slots ? <TodayList slots={slots} /> : <p className="text-sm text-muted">Loading…</p>}
    </div>
  );
}

function WardToday({
  child,
  academicSessionId,
  termId,
}: {
  child: ParentChild;
  academicSessionId: string;
  termId: string;
}) {
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);

  useEffect(() => {
    if (!child.currentClassId) {
      setSlots([]);
      return;
    }
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?classArmId=${child.currentClassId}&academicSessionId=${academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then((all) => setSlots(todaySlotsOf(all)))
      .catch(() => setSlots([]));
  }, [child.currentClassId, academicSessionId, termId]);

  return (
    <div>
      <RoleTag label="Parent" variant="success" />
      <div className="mb-1 text-[12.5px] font-medium">
        {child.user.firstName} {child.user.lastName}
      </div>
      {slots ? <TodayList slots={slots} /> : <p className="text-sm text-muted">Loading…</p>}
    </div>
  );
}

function StaffToday({
  staffId,
  academicSessionId,
  termId,
}: {
  staffId: string;
  academicSessionId: string;
  termId: string;
}) {
  const { data: assignments } = useQuery({
    queryKey: ["staff-assignments", "mine"],
    queryFn: () => apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true }),
  });
  const classTeacherArms = (assignments ?? []).filter(
    (a) => a.assignmentType === "CLASS_TEACHER" && a.isActive && a.classArmId && a.classArm,
  );
  const isSubjectTeacher = (assignments ?? []).some((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive);

  const [ownSlots, setOwnSlots] = useState<TimetableSlotItem[] | null>(null);
  useEffect(() => {
    if (!isSubjectTeacher) return;
    apiFetch<TimetableSlotItem[]>(`/timetable-slots?staffId=${staffId}&academicSessionId=${academicSessionId}&termId=${termId}`, {
      auth: true,
    })
      .then((all) => setOwnSlots(todaySlotsOf(all)))
      .catch(() => setOwnSlots([]));
  }, [isSubjectTeacher, staffId, academicSessionId, termId]);

  return (
    <>
      {classTeacherArms.map((a) => (
        <ClassTeacherToday
          key={a.classArmId}
          classArmId={a.classArmId!}
          className={`${a.classArm!.classLevel.name} ${a.classArm!.name}`}
          academicSessionId={academicSessionId}
          termId={termId}
        />
      ))}
      {isSubjectTeacher && (
        <div>
          <RoleTag label="Subject teacher" variant="warning" />
          {ownSlots ? <TodayList slots={ownSlots} showClass /> : <p className="text-sm text-muted">Loading…</p>}
        </div>
      )}
    </>
  );
}

function ClassTeacherToday({
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
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);
  useEffect(() => {
    apiFetch<TimetableSlotItem[]>(`/timetable-slots?classArmId=${classArmId}&academicSessionId=${academicSessionId}&termId=${termId}`, {
      auth: true,
    })
      .then((all) => setSlots(todaySlotsOf(all)))
      .catch(() => setSlots([]));
  }, [classArmId, academicSessionId, termId]);

  return (
    <div>
      <RoleTag label="Class teacher" variant="info" />
      <div className="mb-1 text-[12.5px] font-medium">{className}</div>
      {slots ? <TodayList slots={slots} /> : <p className="text-sm text-muted">Loading…</p>}
    </div>
  );
}
