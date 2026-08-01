"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

type AssignmentType =
  | "SUBJECT_TEACHER"
  | "CLASS_TEACHER"
  | "BURSAR"
  | "REGISTRAR"
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "HEADTEACHER"
  | "OTHER";

const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
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
}
interface AcademicSessionOption {
  id: string;
  name: string;
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

  const [staffId, setStaffId] = useState("");
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("SUBJECT_TEACHER");
  const [classArmId, setClassArmId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [allowCoTeaching, setAllowCoTeaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const assignableTypes = isSuperAdmin
    ? (Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[])
    : ADMIN_ASSIGNABLE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
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
      onAssigned?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

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
