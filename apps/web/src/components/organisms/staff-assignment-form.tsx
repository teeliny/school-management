"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";

export type AssignmentType =
  | "SUBJECT_TEACHER"
  | "CLASS_TEACHER"
  | "BURSAR"
  | "REGISTRAR"
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "HEADTEACHER"
  | "OTHER";

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  SUBJECT_TEACHER: "Subject Teacher",
  CLASS_TEACHER: "Class Teacher",
  BURSAR: "Bursar",
  REGISTRAR: "Registrar",
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  HEADTEACHER: "Headteacher",
  OTHER: "Other",
};

// PRD FR3.1: Bursar/Registrar report to Super-Admin only — the option isn't
// even offered to an Admin viewer, matching the backend's CASL restriction.
const ADMIN_ASSIGNABLE: AssignmentType[] = [
  "SUBJECT_TEACHER",
  "CLASS_TEACHER",
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "HEADTEACHER",
  "OTHER",
];

interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}
interface ClassArmOption {
  id: string;
  name: string;
  classLevel?: { category: string };
}
interface AcademicSessionOption {
  id: string;
  name: string;
}
interface SubjectOption {
  id: string;
  name: string;
  isGroup: boolean;
  classSubjects?: { classLevelCategory: string }[];
  childSubjects?: { id: string; name: string }[];
}

export function StaffAssignmentForm({
  isSuperAdmin,
  onAssigned,
}: {
  isSuperAdmin: boolean;
  onAssigned?: () => void;
}) {
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);

  const [staffId, setStaffId] = useState("");
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("SUBJECT_TEACHER");
  const [classArmId, setClassArmId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [allowCoTeaching, setAllowCoTeaching] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [classArmIds, setClassArmIds] = useState<string[]>([]);
  const [subjectTeacherClassArms, setSubjectTeacherClassArms] = useState<ClassArmOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setSessions)
      .catch(() => setSessions([]));
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
  }, []);

  useEffect(() => {
    if (assignmentType !== "SUBJECT_TEACHER" || !academicSessionId) {
      setSubjectTeacherClassArms([]);
      return;
    }
    apiFetch<ClassArmOption[]>(`/class-arms?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setSubjectTeacherClassArms)
      .catch(() => setSubjectTeacherClassArms([]));
  }, [assignmentType, academicSessionId]);

  useEffect(() => {
    if (assignmentType !== "SUBJECT_TEACHER" || !staffId || !subjectId || !academicSessionId) {
      setClassArmIds([]);
      return;
    }
    apiFetch<string[]>(
      `/staff-assignments/subject-teacher?staffId=${staffId}&subjectId=${subjectId}&academicSessionId=${academicSessionId}`,
      { auth: true },
    )
      .then(setClassArmIds)
      .catch(() => setClassArmIds([]));
  }, [assignmentType, staffId, subjectId, academicSessionId]);

  const assignableTypes = isSuperAdmin
    ? (Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[])
    : ADMIN_ASSIGNABLE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (assignmentType === "SUBJECT_TEACHER") {
        await apiFetch("/staff-assignments/subject-teacher/sync", {
          method: "POST",
          auth: true,
          body: { staffId, subjectId, academicSessionId, classArmIds },
        });
        setSuccess("Subject teacher assignments updated.");
      } else {
        await apiFetch("/staff-assignments", {
          method: "POST",
          auth: true,
          body: {
            staffId,
            assignmentType,
            classArmId: classArmId || undefined,
            academicSessionId,
            allowCoTeaching: assignmentType === "CLASS_TEACHER" ? allowCoTeaching : undefined,
          },
        });
        setSuccess("Assignment created.");
      }
      onAssigned?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  // A "group" subject (e.g. Basic Science and Technology) is never itself
  // taught/scored — its child subjects (Basic Science, Basic Technology, …)
  // are, each by its own teacher. So a group is never a selectable Subject
  // Teacher target; its children are, in its place, inheriting the group's
  // catalogued class group(s) since children don't carry their own.
  const selectableSubjects = subjects.flatMap((subject) =>
    subject.isGroup && subject.childSubjects && subject.childSubjects.length > 0
      ? subject.childSubjects.map((child) => ({
          id: child.id,
          name: `${child.name} (${subject.name})`,
          classSubjects: subject.classSubjects,
        }))
      : [{ id: subject.id, name: subject.name, classSubjects: subject.classSubjects }],
  );

  // A subject only applies to the class group(s) it's catalogued under
  // (Subject.classSubjects) — e.g. a JSS-only subject shouldn't offer SSS
  // class arms. Falls back to the unfiltered session-scoped list when the
  // subject has no catalogued group (shouldn't normally happen) so the
  // field isn't silently empty.
  const selectedSubjectGroups = selectableSubjects.find((s) => s.id === subjectId)?.classSubjects?.map((cs) => cs.classLevelCategory) ?? [];
  const eligibleClassArms =
    selectedSubjectGroups.length > 0
      ? subjectTeacherClassArms.filter((arm) => arm.classLevel && selectedSubjectGroups.includes(arm.classLevel.category))
      : subjectTeacherClassArms;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div>
        <Label htmlFor="assignment-staff">Staff member</Label>
        <Select value={staffId} onValueChange={setStaffId}>
          <SelectTrigger id="assignment-staff" className="mt-1">
            <SelectValue placeholder="Select staff" />
          </SelectTrigger>
          <SelectContent>
            {staffOptions.map((staff) => (
              <SelectItem key={staff.id} value={staff.id}>
                {staff.user.firstName} {staff.user.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="assignment-type">Assignment type</Label>
        <Select value={assignmentType} onValueChange={(value) => setAssignmentType(value as AssignmentType)}>
          <SelectTrigger id="assignment-type" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignableTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {ASSIGNMENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {assignmentType === "SUBJECT_TEACHER" ? (
        <div>
          <Label htmlFor="assignment-subject">Subject</Label>
          <Select
            value={subjectId}
            onValueChange={setSubjectId}
            onOpenChange={(open) => {
              if (!open) setSubjectSearch("");
            }}
          >
            <SelectTrigger id="assignment-subject" className="mt-1">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent className="max-h-72 overflow-y-auto">
              <div className="p-1 pb-0">
                <Input
                  placeholder="Search subjects…"
                  value={subjectSearch}
                  onChange={(e) => setSubjectSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="mb-1"
                />
              </div>
              {selectableSubjects
                .filter((subject) => subject.name.toLowerCase().includes(subjectSearch.trim().toLowerCase()))
                .map((subject) => {
                  const groups = [...new Set(subject.classSubjects?.map((cs) => cs.classLevelCategory) ?? [])];
                  return (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                      {groups.length > 0 && <span className="text-muted"> · {groups.join(", ")}</span>}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div>
          <Label htmlFor="assignment-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="assignment-class-arm" className="mt-1">
              <SelectValue placeholder="Not applicable" />
            </SelectTrigger>
            <SelectContent>
              {classArms.map((classArm) => (
                <SelectItem key={classArm.id} value={classArm.id}>
                  {classArm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="assignment-session">Academic session</Label>
        <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
          <SelectTrigger id="assignment-session" className="mt-1">
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {assignmentType === "SUBJECT_TEACHER" && (
        <div>
          <Label htmlFor="assignment-class-arms">Class arms</Label>
          <MultiSelect
            id="assignment-class-arms"
            value={classArmIds}
            onValueChange={setClassArmIds}
            options={eligibleClassArms.map((arm) => ({ value: arm.id, label: arm.name }))}
            placeholder={
              !academicSessionId ? "Select an academic session first" : !subjectId ? "Select a subject first" : "Select class arms"
            }
            className="mt-1"
          />
        </div>
      )}

      {assignmentType === "CLASS_TEACHER" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowCoTeaching}
            onChange={(e) => setAllowCoTeaching(e.target.checked)}
          />
          Allow co-teaching (override the existing class teacher check — PRD FR3.3)
        </label>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}
