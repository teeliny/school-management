"use client";

import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";
import { PhotoCaptureDialog } from "./photo-capture-dialog";

type Relationship = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";
type Gender = "MALE" | "FEMALE" | "OTHER";

interface GuardianRow {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  relationship: Relationship;
  isPrimaryContact: boolean;
}

interface ClassArm {
  id: string;
  name: string;
  displayName: string;
}

function emptyGuardian(): GuardianRow {
  return { email: "", firstName: "", lastName: "", phone: "", address: "", relationship: "FATHER", isPrimaryContact: false };
}

export function CreateStudentForm({ onCreated }: { onCreated?: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [classArmId, setClassArmId] = useState<string>("");
  const [classArms, setClassArms] = useState<ClassArm[]>([]);
  const [guardians, setGuardians] = useState<GuardianRow[]>([emptyGuardian()]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<ClassArm[]>("/class-arms", { auth: true })
      .then(setClassArms)
      .catch(() => setClassArms([]));
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  function updateGuardian(index: number, patch: Partial<GuardianRow>) {
    setGuardians((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addGuardian() {
    setGuardians((rows) => [...rows, emptyGuardian()]);
  }

  function removeGuardian(index: number) {
    setGuardians((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setWarning(null);
    if (!classArmId) {
      setError("Class is required — the admission number is generated from it.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiFetch<{ id: string; admissionNumber: string }>("/students", {
        method: "POST",
        auth: true,
        body: {
          firstName,
          lastName,
          gender: gender || undefined,
          admissionDate,
          classArmId,
          guardians: guardians.map((g) => ({
            ...g,
            phone: g.phone.trim() || undefined,
            address: g.address.trim() || undefined,
          })),
        },
      });
      setSuccess(`${firstName} ${lastName} was created — admission number ${created.admissionNumber}.`);

      // Photo is optional and uploaded only after the student record exists
      // (POST /students/:id/photo needs a studentId) — a failure here
      // shouldn't undo an otherwise-successful enrollment.
      if (photoFile) {
        try {
          const formData = new FormData();
          formData.append("file", photoFile);
          await apiFetch(`/students/${created.id}/photo`, { method: "POST", auth: true, body: formData });
        } catch {
          setWarning("Student was enrolled, but the photo failed to upload — you can add it later from the students list.");
        }
      }

      setFirstName("");
      setLastName("");
      setGender("");
      setAdmissionDate("");
      setClassArmId("");
      setGuardians([emptyGuardian()]);
      setPhotoFile(null);
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}
      {warning && <p className="text-sm text-warning">{warning}</p>}

      <div>
        <Label>Student photo <span className="text-muted">(optional)</span></Label>
        <div className="mt-1 flex items-center gap-3">
          {photoPreviewUrl ? (
            <img src={photoPreviewUrl} alt="Student preview" className="h-14 w-14 rounded-lg border border-border object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border text-muted">
              <Camera className="h-5 w-5" />
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setCaptureOpen(true)}>
            <Camera className="h-3.5 w-3.5" /> {photoFile ? "Retake photo" : "Take photo"}
          </Button>
          {photoFile && (
            <Button type="button" variant="outline" size="sm" onClick={() => setPhotoFile(null)}>
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="First name"
          id="student-first-name"
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <FormField
          label="Last name"
          id="student-last-name"
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
        <FormField
          label="Admission date"
          id="student-admission-date"
          type="date"
          required
          value={admissionDate}
          onChange={(e) => setAdmissionDate(e.target.value)}
        />
        <div>
          <Label htmlFor="student-gender">Gender</Label>
          <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
            <SelectTrigger id="student-gender" className="mt-1">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MALE">Male</SelectItem>
              <SelectItem value="FEMALE">Female</SelectItem>
              <SelectItem value="OTHER">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="student-class-arm">
          Class <span className="text-danger">*</span>{" "}
          <span className="text-muted">(admission number is generated from this)</span>
        </Label>
        <Select value={classArmId} onValueChange={setClassArmId}>
          <SelectTrigger id="student-class-arm" className="mt-1">
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Guardians <span className="text-muted">(at least one required — PRD §3.1)</span>
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addGuardian}>
            Add guardian
          </Button>
        </div>

        {guardians.map((guardian, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Guardian first name"
                id={`guardian-${index}-first-name`}
                required
                value={guardian.firstName}
                onChange={(e) => updateGuardian(index, { firstName: e.target.value })}
              />
              <FormField
                label="Guardian last name"
                id={`guardian-${index}-last-name`}
                required
                value={guardian.lastName}
                onChange={(e) => updateGuardian(index, { lastName: e.target.value })}
              />
            </div>
            <FormField
              label="Guardian email"
              id={`guardian-${index}-email`}
              type="email"
              required
              value={guardian.email}
              onChange={(e) => updateGuardian(index, { email: e.target.value })}
            />
            <p className="text-xs text-muted">
              If this email already belongs to someone in the system, they&apos;ll simply gain a
              Parent role on their existing account (PRD FR1.5) — otherwise they&apos;ll be invited.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Guardian phone"
                id={`guardian-${index}-phone`}
                value={guardian.phone}
                onChange={(e) => updateGuardian(index, { phone: e.target.value })}
              />
              <FormField
                label="Guardian address"
                id={`guardian-${index}-address`}
                value={guardian.address}
                onChange={(e) => updateGuardian(index, { address: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <Label htmlFor={`guardian-${index}-relationship`}>Relationship</Label>
                <Select
                  value={guardian.relationship}
                  onValueChange={(value) => updateGuardian(index, { relationship: value as Relationship })}
                >
                  <SelectTrigger id={`guardian-${index}-relationship`} className="mt-1">
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
              {guardians.length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={() => removeGuardian(index)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Enrolling…" : "Enroll student"}
      </Button>

      <PhotoCaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} onCapture={setPhotoFile} />
    </form>
  );
}
