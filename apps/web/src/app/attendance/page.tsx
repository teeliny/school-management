"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { FormField } from "../../components/molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { SearchableSelect } from "../../components/molecules/searchable-select";
import { AttendanceRollCall, type RollCallMode } from "../../components/organisms/attendance-roll-call";
import { AttendanceTermSummary } from "../../components/organisms/attendance-term-summary";
import { SchoolHolidayManager } from "../../components/organisms/school-holiday-manager";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: string };
}
interface SubjectOption {
  id: string;
  name: string;
  isGroup: boolean;
  childSubjects?: { id: string; name: string }[];
}
interface TermOption {
  id: string;
  name: string;
}
interface StaffAssignmentItem {
  assignmentType: string;
  classArmId: string | null;
  subjectId: string | null;
  isActive: boolean;
}
interface SchoolProfile {
  attendanceGranularity: "DAILY" | "MORNING_AND_AFTERNOON";
  attendanceBackdateWindowDays: number;
}

const MODE_LABEL: Record<RollCallMode, string> = {
  STUDENT_DAILY: "Class register (daily)",
  STUDENT_PERIOD: "Subject period",
  STAFF_DAILY: "Staff register",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendancePage() {
  const { user, loading, logout } = useCurrentUser();
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);
  const [schoolProfile, setSchoolProfile] = useState<SchoolProfile | null>(null);

  const [mode, setMode] = useState<RollCallMode | "">("");
  const [classArmId, setClassArmId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayInput());
  const [dailyPeriod, setDailyPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [summaryTermId, setSummaryTermId] = useState("");

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setMyAssignments)
      .catch(() => setMyAssignments([]));
    apiFetch<SchoolProfile>("/school-profile", { auth: true }).then(setSchoolProfile).catch(() => setSchoolProfile(null));
  }, []);

  // Matches the backend CASL grant: Principal/Headteacher get `manage
  // AttendanceSession/AttendanceRecord/SchoolHoliday` too (ability.factory.ts).
  const isAdmin = user
    ? user.roles.includes("SUPER_ADMIN") ||
      user.roles.includes("ADMIN") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t))
    : false;
  const isRegistrar = user ? user.assignmentTypes.includes("REGISTRAR") : false;

  const myClassTeacherAssignments = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "CLASS_TEACHER" && a.isActive),
    [myAssignments],
  );
  const mySubjectTeacherAssignments = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive),
    [myAssignments],
  );

  const availableModes = useMemo(() => {
    const modes: RollCallMode[] = [];
    if (isAdmin || myClassTeacherAssignments.length > 0) modes.push("STUDENT_DAILY");
    if (isAdmin || mySubjectTeacherAssignments.length > 0) modes.push("STUDENT_PERIOD");
    if (isAdmin || isRegistrar) modes.push("STAFF_DAILY");
    return modes;
  }, [isAdmin, isRegistrar, myClassTeacherAssignments, mySubjectTeacherAssignments]);

  useEffect(() => {
    const first = availableModes[0];
    if (!mode && first) setMode(first);
  }, [mode, availableModes]);

  // Reset the whole downstream selection whenever the mode itself changes —
  // a class arm valid for STUDENT_DAILY may not even be an option under
  // STUDENT_PERIOD's different assignment scoping.
  useEffect(() => {
    setClassArmId("");
    setSubjectId("");
    setPeriodLabel("");
    setDailyPeriod("");
  }, [mode]);

  const classArmOptions =
    mode === "STUDENT_DAILY"
      ? isAdmin
        ? classArms
        : classArms.filter((arm) => myClassTeacherAssignments.some((a) => a.classArmId === arm.id))
      : mode === "STUDENT_PERIOD"
        ? isAdmin
          ? classArms
          : classArms.filter((arm) => mySubjectTeacherAssignments.some((a) => a.classArmId === arm.id))
        : [];

  // Subjects scoped to the selected class arm's class-level category, same
  // pattern as gradebook — and only relevant for the PERIOD mode.
  useEffect(() => {
    setSubjectId("");
    if (mode !== "STUDENT_PERIOD") {
      setSubjects([]);
      return;
    }
    const classLevelCategory = classArms.find((a) => a.id === classArmId)?.classLevel.category;
    if (!classLevelCategory) {
      setSubjects([]);
      return;
    }
    apiFetch<SubjectOption[]>(`/subjects?classLevelCategory=${classLevelCategory}`, { auth: true })
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, [mode, classArmId, classArms]);

  // A "group" subject is never itself assignable — only its child subjects
  // are (PRD §3.3), same flattening as gradebook/staff-assignment-form.
  const selectableSubjects = subjects.flatMap((subject) =>
    subject.isGroup && subject.childSubjects && subject.childSubjects.length > 0
      ? subject.childSubjects.map((child) => ({ id: child.id, name: `${child.name} (${subject.name})` }))
      : [{ id: subject.id, name: subject.name }],
  );
  const subjectOptions = isAdmin
    ? selectableSubjects
    : selectableSubjects.filter((subject) =>
        mySubjectTeacherAssignments.some((a) => a.classArmId === classArmId && a.subjectId === subject.id),
      );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  if (availableModes.length === 0) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Operations · Attendance" title="Attendance" />
        <Card>
          <p className="text-sm text-muted">
            You have no active class-teacher, subject-teacher, or registrar assignment to take attendance for.
          </p>
        </Card>
      </AppShell>
    );
  }

  const needsGranularityPeriod = schoolProfile?.attendanceGranularity === "MORNING_AND_AFTERNOON" && mode === "STUDENT_DAILY";
  const effectivePeriod = mode === "STUDENT_PERIOD" ? periodLabel : needsGranularityPeriod ? dailyPeriod : "";

  const rollCallReady =
    mode === "STAFF_DAILY"
      ? Boolean(date)
      : mode === "STUDENT_DAILY"
        ? Boolean(classArmId && date && (!needsGranularityPeriod || dailyPeriod))
        : mode === "STUDENT_PERIOD"
          ? Boolean(classArmId && subjectId && date && periodLabel)
          : false;

  const showTermSummarySection = (isAdmin || isRegistrar) && (mode === "STUDENT_DAILY" || mode === "STUDENT_PERIOD");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Operations · Attendance" title="Attendance" />

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <Card>
          <CardHeader title="Roll call" sub="Mark or correct a register" />

          <div className="mb-4 space-y-3">
            {availableModes.length > 1 && (
              <div>
                <Label htmlFor="att-mode">Type</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as RollCallMode)}>
                  <SelectTrigger id="att-mode" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModes.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODE_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {mode !== "STAFF_DAILY" && (
                <div>
                  <Label htmlFor="att-class-arm">Class arm</Label>
                  <Select value={classArmId} onValueChange={setClassArmId}>
                    <SelectTrigger id="att-class-arm" className="mt-1">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classArmOptions.map((arm) => (
                        <SelectItem key={arm.id} value={arm.id}>
                          {arm.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {mode === "STUDENT_PERIOD" && (
                <div>
                  <Label htmlFor="att-subject">Subject</Label>
                  <SearchableSelect
                    id="att-subject"
                    value={subjectId}
                    onValueChange={setSubjectId}
                    options={subjectOptions.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder={classArmId ? "Select subject" : "Select a class arm first"}
                    className="mt-1"
                  />
                </div>
              )}
              <FormField label="Date" id="att-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {mode === "STUDENT_PERIOD" && (
                <FormField
                  label="Period"
                  id="att-period"
                  placeholder="e.g. Period 4"
                  required
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                />
              )}
              {needsGranularityPeriod && (
                <div>
                  <Label htmlFor="att-daily-period">Session</Label>
                  <Select value={dailyPeriod} onValueChange={setDailyPeriod}>
                    <SelectTrigger id="att-daily-period" className="mt-1">
                      <SelectValue placeholder="Select session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MORNING">Morning</SelectItem>
                      <SelectItem value="AFTERNOON">Afternoon</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {rollCallReady && mode ? (
            <AttendanceRollCall
              mode={mode}
              classArmId={mode === "STAFF_DAILY" ? undefined : classArmId}
              subjectId={mode === "STUDENT_PERIOD" ? subjectId : undefined}
              date={date}
              period={effectivePeriod || undefined}
              backdateWindowDays={schoolProfile?.attendanceBackdateWindowDays ?? 3}
            />
          ) : (
            <p className="text-sm text-muted">Select the fields above to begin.</p>
          )}
        </Card>

        {showTermSummarySection && (
          <Card>
            <CardHeader title="Term attendance" sub="Attendance trend for the selected class" />
            <div className="mb-3">
              <Label htmlFor="att-summary-term">Term</Label>
              <Select value={summaryTermId} onValueChange={setSummaryTermId}>
                <SelectTrigger id="att-summary-term" className="mt-1">
                  <SelectValue placeholder="Select term" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {classArmId && summaryTermId ? (
              <AttendanceTermSummary classArmId={classArmId} termId={summaryTermId} />
            ) : (
              <p className="text-sm text-muted">Select a class arm on the left and a term above.</p>
            )}
          </Card>
        )}
      </div>

      {isAdmin && (
        <Card className="mt-4">
          <CardHeader title="School holidays" sub="Subtracted from school-days-opened for attendance and report cards" />
          <SchoolHolidayManager />
        </Card>
      )}
    </AppShell>
  );
}
