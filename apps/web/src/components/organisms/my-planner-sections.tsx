"use client";

import { useEffect, useMemo, useState } from "react";
import { categoryToGroup, DAYS_OF_WEEK, type ClassLevelCategory, type ClassLevelCategoryGroup, type DayOfWeek } from "@school/types";
import { apiFetch } from "../../lib/api";
import { buildPeriodColumns, findSpecialPeriod, fridayCutoffColumnIndex, resolvePeriodIndex } from "../../lib/period-columns";
import { usePeriodStructure, useSpecialPeriods } from "../../lib/use-period-structure";
import { CollapsibleCard } from "../molecules/collapsible-card";
import { ReadOnlyScheduleTable } from "../molecules/read-only-schedule-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { Tabs, TabsList, TabsTrigger } from "../molecules/tabs";
import { TimetableGrid } from "./timetable-grid";

export interface MyStaffAssignment {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  subjectId: string | null;
  classArm: { name: string; classLevel: { name: string; category: ClassLevelCategory } } | null;
  subject: { id: string; name: string } | null;
}
export interface MyWard {
  id: string;
  currentClassId: string | null;
  status: string;
  user: { firstName: string; lastName: string };
}
interface ExamScheduleItem {
  id: string;
  classArmId: string;
  subject: { id: string; name: string };
  date: string;
  startTime: string;
  endTime: string;
}
interface TimetableSlotItem {
  id: string;
  classArmId: string;
  subject: { name: string };
  classArm: { displayName: string };
  dayOfWeek: DayOfWeek;
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

const DAY_LABEL: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri" };
const ALL_CLASSES = "__all__";

/**
 * "My class timetable" (class teacher) — one section per homeroom she's the
 * active CLASS_TEACHER of, the whole class's grid (all subjects/teachers,
 * since it's her own class).
 */
export function MyClassTimetableSection({
  assignments,
  academicSessionId,
  termId,
}: {
  assignments: MyStaffAssignment[];
  academicSessionId: string;
  termId: string;
}) {
  if (assignments.length === 0) return null;
  return (
    <div className="space-y-4">
      {assignments.map((a) => (
        <CollapsibleCard key={a.classArmId} title={`My class timetable — ${a.classArm!.classLevel.name} ${a.classArm!.name}`}>
          <TimetableGrid classArmId={a.classArmId!} academicSessionId={academicSessionId} termId={termId} canManage={false} />
        </CollapsibleCard>
      ))}
    </div>
  );
}

/**
 * "My teaching timetable" (subject teacher) — one dropdown, "All my classes"
 * first (the default) plus each of her own taught classes individually,
 * never the whole school's class list. Both options render the same
 * Day(row) x Period(column) grid shape as "My class timetable" — "All my
 * classes" merges every one of her classes into it (a teacher's own periods
 * never overlap in time, so this is just her real personal timetable),
 * "Per class" narrows to just one. Split into one grid per distinct
 * classLevelCategory group in the (rare) case she teaches across both
 * Primary and Secondary, since each group runs its own period structure.
 */
export function MySubjectTimetableSection({
  assignments,
  staffId,
  academicSessionId,
  termId,
}: {
  assignments: MyStaffAssignment[];
  staffId: string;
  academicSessionId: string;
  termId: string;
}) {
  const classOptions = useMemo(
    () =>
      assignments.map((a) => ({
        classArmId: a.classArmId!,
        subjectId: a.subjectId!,
        group: categoryToGroup(a.classArm!.classLevel.category),
        label: `${a.classArm!.classLevel.name} ${a.classArm!.name} — ${a.subject!.name}`,
      })),
    [assignments],
  );
  const classArmIdToGroup = useMemo(() => new Map(classOptions.map((o) => [o.classArmId, o.group])), [classOptions]);
  const groups = useMemo(() => [...new Set(classOptions.map((o) => o.group))], [classOptions]);
  const [selectedClassArmId, setSelectedClassArmId] = useState<string>(ALL_CLASSES);
  const selected = classOptions.find((o) => o.classArmId === selectedClassArmId);
  const [slots, setSlots] = useState<TimetableSlotItem[]>([]);

  useEffect(() => {
    const classArmQuery = selected ? `&classArmId=${selected.classArmId}` : "";
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?staffId=${staffId}&academicSessionId=${academicSessionId}&termId=${termId}${classArmQuery}`,
      { auth: true },
    )
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [selected, staffId, academicSessionId, termId]);

  if (classOptions.length === 0) return null;

  return (
    <CollapsibleCard title="My teaching timetable">
      <Select value={selectedClassArmId} onValueChange={setSelectedClassArmId}>
        <SelectTrigger className="mb-3 max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CLASSES}>All my classes</SelectItem>
          {classOptions.map((o) => (
            <SelectItem key={o.classArmId} value={o.classArmId}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <PeriodWeekGrid slots={slots} group={selected.group} />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <PeriodWeekGrid
              key={group}
              slots={slots.filter((s) => classArmIdToGroup.get(s.classArmId) === group)}
              group={group}
            />
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}

/**
 * "My child's timetable" (parent) — a ward selector (only when there's more
 * than one) and the selected ward's full class grid.
 */
export function MyWardTimetableSection({
  wards,
  selectedWardId,
  onSelectWard,
  academicSessionId,
  termId,
}: {
  wards: MyWard[];
  selectedWardId: string | null;
  onSelectWard: (id: string) => void;
  academicSessionId: string;
  termId: string;
}) {
  if (wards.length === 0) return null;
  const selected = wards.find((w) => w.id === selectedWardId) ?? wards[0]!;

  return (
    <CollapsibleCard title="My child's timetable">
      {wards.length > 1 && (
        <div className="mb-3">
          <Tabs value={selected.id} onValueChange={onSelectWard}>
            <TabsList>
              {wards.map((w) => (
                <TabsTrigger key={w.id} value={w.id}>
                  {w.user.firstName} {w.user.lastName}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      {selected.currentClassId ? (
        <TimetableGrid classArmId={selected.currentClassId} academicSessionId={academicSessionId} termId={termId} canManage={false} />
      ) : (
        <p className="text-sm text-muted">No class assigned yet.</p>
      )}
    </CollapsibleCard>
  );
}

/** Exam-schedule sibling of MyClassTimetableSection above. */
export function MyClassExamSection({ assignments }: { assignments: MyStaffAssignment[] }) {
  if (assignments.length === 0) return null;
  return (
    <div className="space-y-4">
      {assignments.map((a) => (
        <CollapsibleCard key={a.classArmId} title={`My class exam schedule — ${a.classArm!.classLevel.name} ${a.classArm!.name}`}>
          <ExamScheduleList classArmId={a.classArmId!} />
        </CollapsibleCard>
      ))}
    </div>
  );
}

/**
 * Exam-schedule sibling of MySubjectTimetableSection above. Exam schedules
 * aren't naturally grid-shaped the way a weekly timetable is (no fixed
 * period structure — AllClassesExamTimetableView's date/time grid only makes
 * sense within one chosen assessment-component batch), so "All classes"
 * here is a flat merged list across her own classes/subjects instead of
 * reusing that grid component.
 */
export function MySubjectExamSection({ assignments }: { assignments: MyStaffAssignment[] }) {
  const classOptions = useMemo(
    () =>
      assignments.map((a) => ({
        classArmId: a.classArmId!,
        subjectId: a.subjectId!,
        label: `${a.classArm!.classLevel.name} ${a.classArm!.name} — ${a.subject!.name}`,
      })),
    [assignments],
  );
  const [selectedClassArmId, setSelectedClassArmId] = useState<string>(ALL_CLASSES);
  const selected = classOptions.find((o) => o.classArmId === selectedClassArmId);
  const [rows, setRows] = useState<ExamScheduleItem[]>([]);

  useEffect(() => {
    if (!selected) {
      Promise.all(
        classOptions.map((o) =>
          apiFetch<ExamScheduleItem[]>(`/exam-schedules?classArmId=${o.classArmId}`, { auth: true })
            .then((all) => all.filter((r) => r.subject.id === o.subjectId))
            .catch(() => []),
        ),
      ).then((rowsPerClass) => setRows(rowsPerClass.flat()));
      return;
    }
    apiFetch<ExamScheduleItem[]>(`/exam-schedules?classArmId=${selected.classArmId}`, { auth: true })
      .then((all) => setRows(all.filter((r) => r.subject.id === selected.subjectId)))
      .catch(() => setRows([]));
  }, [selected, classOptions]);

  if (classOptions.length === 0) return null;

  return (
    <CollapsibleCard title="My subject's exam schedule">
      <Select value={selectedClassArmId} onValueChange={setSelectedClassArmId}>
        <SelectTrigger className="mb-3 max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CLASSES}>All my classes</SelectItem>
          {classOptions.map((o) => (
            <SelectItem key={o.classArmId} value={o.classArmId}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ReadOnlyScheduleTable
        headers={["Subject", "Class", "Date", "Time"]}
        rows={rows.map((e) => ({
          id: e.id,
          cells: [
            e.subject.name,
            classOptions.find((o) => o.classArmId === e.classArmId)?.label ?? "",
            new Date(e.date).toLocaleDateString(),
            `${e.startTime}–${e.endTime}`,
          ],
        }))}
        emptyMessage="No exam scheduled yet."
      />
    </CollapsibleCard>
  );
}

/** Exam-schedule sibling of MyWardTimetableSection above. */
export function MyWardExamSection({
  wards,
  selectedWardId,
  onSelectWard,
}: {
  wards: MyWard[];
  selectedWardId: string | null;
  onSelectWard: (id: string) => void;
}) {
  if (wards.length === 0) return null;
  const selected = wards.find((w) => w.id === selectedWardId) ?? wards[0]!;

  return (
    <CollapsibleCard title="My child's exam schedule">
      {wards.length > 1 && (
        <div className="mb-3">
          <Tabs value={selected.id} onValueChange={onSelectWard}>
            <TabsList>
              {wards.map((w) => (
                <TabsTrigger key={w.id} value={w.id}>
                  {w.user.firstName} {w.user.lastName}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      {selected.currentClassId ? (
        <ExamScheduleList classArmId={selected.currentClassId} />
      ) : (
        <p className="text-sm text-muted">No class assigned yet.</p>
      )}
    </CollapsibleCard>
  );
}

export function MyInvigilationSection({ staffId }: { staffId: string }) {
  const [invigilations, setInvigilations] = useState<InvigilationAssignmentItem[]>([]);
  useEffect(() => {
    apiFetch<InvigilationAssignmentItem[]>(`/invigilation-assignments?staffId=${staffId}`, { auth: true })
      .then(setInvigilations)
      .catch(() => setInvigilations([]));
  }, [staffId]);

  return (
    <CollapsibleCard title="My invigilation duty">
      <ReadOnlyScheduleTable
        headers={["Role", "Subject", "Class", "Date"]}
        rows={invigilations.map((i) => ({
          id: i.id,
          cells: [i.role, i.examSchedule.subject.name, i.examSchedule.classArm.displayName, new Date(i.examSchedule.date).toLocaleDateString()],
        }))}
        emptyMessage="No invigilation duty assigned."
      />
    </CollapsibleCard>
  );
}

export function MyWeeklyDutySection({ staffId }: { staffId: string }) {
  const [duties, setDuties] = useState<DutyAssignmentItem[]>([]);
  useEffect(() => {
    apiFetch<DutyAssignmentItem[]>(`/duty-assignments?staffId=${staffId}`, { auth: true })
      .then(setDuties)
      .catch(() => setDuties([]));
  }, [staffId]);

  return (
    <CollapsibleCard title="My weekly duty">
      <ReadOnlyScheduleTable
        headers={["Week", "Group"]}
        rows={duties.map((d) => ({
          id: d.id,
          cells: [`week of ${new Date(d.weekStartDate).toLocaleDateString()}`, d.classLevelCategoryGroup],
        }))}
        emptyMessage="No weekly duty assigned."
      />
    </CollapsibleCard>
  );
}

function ExamScheduleList({ classArmId, subjectId }: { classArmId: string; subjectId?: string }) {
  const [rows, setRows] = useState<ExamScheduleItem[]>([]);
  useEffect(() => {
    apiFetch<ExamScheduleItem[]>(`/exam-schedules?classArmId=${classArmId}`, { auth: true })
      .then((all) => setRows(subjectId ? all.filter((r) => r.subject.id === subjectId) : all))
      .catch(() => setRows([]));
  }, [classArmId, subjectId]);

  return (
    <ReadOnlyScheduleTable
      headers={["Subject", "Date", "Time"]}
      rows={rows.map((e) => ({
        id: e.id,
        cells: [e.subject.name, new Date(e.date).toLocaleDateString(), `${e.startTime}–${e.endTime}`],
      }))}
      emptyMessage="No exam schedule published yet."
    />
  );
}

/**
 * Same Day(row) x Period(column) grid shape as TimetableGrid/
 * AllClassesTimetableView (real period columns, break/special-period
 * rendering, Friday's shorter cutoff) — read-only, and each cell shows both
 * subject and class (unlike TimetableGrid's single-class cells, which only
 * need to show subject since the class is implied) since these slots can
 * span several different classes across the week.
 */
function PeriodWeekGrid({ slots, group }: { slots: TimetableSlotItem[]; group: ClassLevelCategoryGroup }) {
  const structure = usePeriodStructure(group);
  const { specialPeriods, fridayTrailingActivity } = useSpecialPeriods(group);
  const columns = useMemo(() => (structure ? buildPeriodColumns(structure) : []), [structure]);
  const fridayCutoff = useMemo(() => (structure ? fridayCutoffColumnIndex(structure, columns) : -1), [structure, columns]);

  const slotByCell = useMemo(() => {
    const map = new Map<string, TimetableSlotItem>();
    if (!structure) return map;
    for (const slot of slots) {
      const periodIndex = resolvePeriodIndex(structure, slot.dayOfWeek, slot.startTime);
      if (periodIndex !== null) map.set(`${slot.dayOfWeek}|${periodIndex}`, slot);
    }
    return map;
  }, [slots, structure]);

  if (!structure) {
    return (
      <p className="text-sm text-muted">
        This class group's period structure isn't fully configured yet — set it under Planner's Constraints.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `50px repeat(${columns.length}, minmax(110px, 1fr))` }}>
        <div />
        {columns.map((col, i) => (
          <div key={i} className="text-center font-mono text-[9.5px] font-medium text-muted">
            {col.kind === "break" ? "Break" : `${col.startTime}–${col.endTime}`}
          </div>
        ))}
        {DAYS_OF_WEEK.map((day) => {
          const lastIndex = day === "FRIDAY" ? fridayCutoff : columns.length - 1;
          return (
            <div key={day} className="contents">
              <div className="pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{DAY_LABEL[day]}</div>
              {columns.slice(0, lastIndex + 1).map((col, i) => {
                if (col.kind === "break") return <div key={i} className="min-h-[52px] rounded-lg bg-muted/10" />;
                const special = findSpecialPeriod(specialPeriods, day, col.index);
                if (special) {
                  return (
                    <div
                      key={i}
                      className="flex min-h-[52px] items-center justify-center rounded-lg bg-info-bg px-1 text-center text-[10px] font-medium text-info"
                    >
                      {special.label}
                    </div>
                  );
                }
                const slot = slotByCell.get(`${day}|${col.index}`);
                return (
                  <div key={i} className="min-h-[52px] p-0.5">
                    {slot && (
                      <div className="rounded-lg border border-border bg-card-inset p-1.5 text-[11.5px]">
                        <div className="truncate font-medium">{slot.subject.name}</div>
                        <div className="truncate text-muted">{slot.classArm.displayName}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {day === "FRIDAY" && fridayCutoff < columns.length - 1 && (
                <div
                  className="flex min-h-[52px] items-center justify-center rounded-lg bg-muted/10 px-1 text-center text-[10px] font-medium text-muted"
                  style={{ gridColumn: `span ${columns.length - 1 - fridayCutoff}` }}
                >
                  {fridayTrailingActivity ? `${fridayTrailingActivity.label} · until ${fridayTrailingActivity.endTime}` : "—"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
