"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

type Relationship = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";
type Gender = "MALE" | "FEMALE" | "OTHER";
type Status = "ACTIVE" | "GRADUATED" | "WITHDRAWN" | "SUSPENDED";

interface ExistingGuardianRow {
  kind: "existing";
  existingParentProfileId: string;
  name: string;
  email: string;
  relationship: Relationship;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
}

interface NewGuardianRow {
  kind: "new";
  email: string;
  firstName: string;
  lastName: string;
  relationship: Relationship;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
}

type GuardianRow = ExistingGuardianRow | NewGuardianRow;

function emptyGuardian(): NewGuardianRow {
  return { kind: "new", email: "", firstName: "", lastName: "", relationship: "FATHER", isPrimaryContact: false, isEmergencyContact: false };
}

interface ClassArm {
  id: string;
  name: string;
  displayName: string;
}

interface StudentDetail {
  id: string;
  status: Status;
  bloodGroup: string | null;
  medicalNotes: string | null;
  currentClass: { id: string } | null;
  user: {
    firstName: string;
    lastName: string;
    middleName: string | null;
    gender: Gender | null;
    dateOfBirth: string | null;
  };
  guardians: {
    relationship: Relationship;
    isPrimaryContact: boolean;
    isEmergencyContact: boolean;
    parent: { id: string; user: { firstName: string; lastName: string; email: string } };
  }[];
}

/**
 * Populates the same right-hand panel CreateStudentForm normally occupies
 * (students/page.tsx), for an already-enrolled student selected via
 * PeopleList's "Edit" button. Guardian rows come in two kinds — "existing"
 * (read-only name/email, editable relationship/contact flags, removable)
 * and "new" (full inline-invite-or-link fields, same shape as
 * CreateStudentForm's guardian rows) — both submitted together as the full
 * desired guardian list; StudentService.update reconciles the diff.
 */
export function EditStudentForm({
  studentId,
  onSaved,
  onCancel,
}: {
  studentId: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [classArmId, setClassArmId] = useState<string>("");
  const [classArms, setClassArms] = useState<ClassArm[]>([]);
  const [bloodGroup, setBloodGroup] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [status, setStatus] = useState<Status>("ACTIVE");
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<StudentDetail>(`/students/${studentId}`, { auth: true })
      .then((student) => {
        setFirstName(student.user.firstName);
        setLastName(student.user.lastName);
        setMiddleName(student.user.middleName ?? "");
        setGender(student.user.gender ?? "");
        setDateOfBirth(student.user.dateOfBirth ? student.user.dateOfBirth.slice(0, 10) : "");
        setClassArmId(student.currentClass?.id ?? "");
        setBloodGroup(student.bloodGroup ?? "");
        setMedicalNotes(student.medicalNotes ?? "");
        setStatus(student.status);
        setGuardians(
          student.guardians.map((g) => ({
            kind: "existing",
            existingParentProfileId: g.parent.id,
            name: `${g.parent.user.firstName} ${g.parent.user.lastName}`,
            email: g.parent.user.email,
            relationship: g.relationship,
            isPrimaryContact: g.isPrimaryContact,
            isEmergencyContact: g.isEmergencyContact,
          })),
        );
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load student"))
      .finally(() => setLoading(false));
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<ClassArm[]>("/class-arms", { auth: true })
      .then(setClassArms)
      .catch(() => setClassArms([]));
  }, []);

  function updateGuardian(index: number, patch: Partial<GuardianRow>) {
    setGuardians((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } as GuardianRow : row)));
  }

  function addGuardian() {
    setGuardians((rows) => [...rows, emptyGuardian()]);
  }

  function removeGuardian(index: number) {
    setGuardians((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (guardians.length === 0) {
      setError("A student must have at least one guardian.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/students/${studentId}`, {
        method: "PATCH",
        auth: true,
        body: {
          firstName,
          lastName,
          // middleName/bloodGroup/medicalNotes are plain optional strings
          // server-side — sent as-is (even empty) so clearing a field in
          // the form actually clears it, unlike gender/dateOfBirth/
          // classArmId below, whose validators reject an empty string and
          // so must be omitted entirely rather than cleared.
          middleName,
          gender: gender || undefined,
          dateOfBirth: dateOfBirth || undefined,
          classArmId: classArmId || undefined,
          bloodGroup,
          medicalNotes,
          status,
          guardians: guardians.map((g) =>
            g.kind === "existing"
              ? {
                  existingParentProfileId: g.existingParentProfileId,
                  relationship: g.relationship,
                  isPrimaryContact: g.isPrimaryContact,
                  isEmergencyContact: g.isEmergencyContact,
                }
              : {
                  email: g.email,
                  firstName: g.firstName,
                  lastName: g.lastName,
                  relationship: g.relationship,
                  isPrimaryContact: g.isPrimaryContact,
                  isEmergencyContact: g.isEmergencyContact,
                },
          ),
        },
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="First name" id="edit-first-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <FormField label="Last name" id="edit-last-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        <FormField label="Middle name" id="edit-middle-name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
        <FormField label="Date of birth" id="edit-dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        <div>
          <Label htmlFor="edit-gender">Gender</Label>
          <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
            <SelectTrigger id="edit-gender" className="mt-1">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MALE">Male</SelectItem>
              <SelectItem value="FEMALE">Female</SelectItem>
              <SelectItem value="OTHER">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-status">Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
            <SelectTrigger id="edit-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="GRADUATED">Graduated</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
              <SelectItem value="SUSPENDED">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="edit-class-arm">Class</Label>
        <Select value={classArmId} onValueChange={setClassArmId}>
          <SelectTrigger id="edit-class-arm" className="mt-1">
            <SelectValue placeholder="Select a class" />
          </SelectTrigger>
          <SelectContent>
            {classArms.map((classArm) => (
              <SelectItem key={classArm.id} value={classArm.id}>
                {classArm.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Blood group" id="edit-blood-group" value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)} />
        <FormField label="Medical notes" id="edit-medical-notes" value={medicalNotes} onChange={(e) => setMedicalNotes(e.target.value)} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Guardians <span className="text-muted">(at least one required)</span>
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addGuardian}>
            Add guardian
          </Button>
        </div>

        {guardians.map((guardian, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-border p-3">
            {guardian.kind === "existing" ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{guardian.name}</p>
                  <p className="text-xs text-muted">{guardian.email}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeGuardian(index)}>
                  <X className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label="Guardian first name"
                    id={`edit-guardian-${index}-first-name`}
                    required
                    value={guardian.firstName}
                    onChange={(e) => updateGuardian(index, { firstName: e.target.value })}
                  />
                  <FormField
                    label="Guardian last name"
                    id={`edit-guardian-${index}-last-name`}
                    required
                    value={guardian.lastName}
                    onChange={(e) => updateGuardian(index, { lastName: e.target.value })}
                  />
                </div>
                <FormField
                  label="Guardian email"
                  id={`edit-guardian-${index}-email`}
                  type="email"
                  required
                  value={guardian.email}
                  onChange={(e) => updateGuardian(index, { email: e.target.value })}
                />
                <p className="text-xs text-muted">
                  If this email already belongs to someone in the system, they&apos;ll simply gain a
                  Parent role on their existing account — otherwise they&apos;ll be invited.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => removeGuardian(index)}>
                  <X className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <Label htmlFor={`edit-guardian-${index}-relationship`}>Relationship</Label>
                <Select
                  value={guardian.relationship}
                  onValueChange={(value) => updateGuardian(index, { relationship: value as Relationship })}
                >
                  <SelectTrigger id={`edit-guardian-${index}-relationship`} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FATHER">Father</SelectItem>
                    <SelectItem value="MOTHER">Mother</SelectItem>
                    <SelectItem value="GUARDIAN">Guardian</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={guardian.isPrimaryContact}
                  onCheckedChange={(checked) => updateGuardian(index, { isPrimaryContact: checked === true })}
                />
                Primary
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={guardian.isEmergencyContact}
                  onCheckedChange={(checked) => updateGuardian(index, { isEmergencyContact: checked === true })}
                />
                Emergency
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="flex-1">
          {submitting ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
