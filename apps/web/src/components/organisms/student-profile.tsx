"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, User as UserIcon } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { FormField } from "../molecules/form-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";
import { PhotoUploadButton } from "../molecules/photo-upload-button";

interface Guardian {
  id: string;
  relationship: string;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  parent: {
    id: string;
    address: string | null;
    emailChangedByStaffAt: string | null;
    user: { firstName: string; lastName: string; email: string; phone: string | null };
  };
}

interface StudentDetail {
  id: string;
  admissionNumber: string;
  status: string;
  studentTitle: string | null;
  bloodGroup: string | null;
  medicalNotes: string | null;
  currentClass: { id: string; name: string; classLevel: { name: string; category: string } } | null;
  user: {
    firstName: string;
    lastName: string;
    middleName: string | null;
    gender: string | null;
    avatarUrl: string | null;
  };
  guardians: Guardian[];
  departmentHistory: { department: { name: string } }[];
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  GRADUATED: "info",
  WITHDRAWN: "muted",
  SUSPENDED: "danger",
};

interface AssessmentComponentOption {
  id: string;
  type: "CA" | "MID_TERM" | "EXAM";
}

/**
 * Full detail view for one student — reached via the "View" button on the
 * PeopleList row (students/page.tsx). `canUploadPhoto` mirrors the same
 * Admin/Super-Admin-or-CLASS_TEACHER gate the list uses; the real per-class
 * authorization is enforced server-side (StudentService.uploadPhoto).
 * `canViewFees` mirrors fees/page.tsx's own gate (Bursar/Super-Admin, or a
 * Parent — safe to compute from role alone here since a Parent could only
 * ever have loaded this profile in the first place if this is her own ward,
 * per StudentService.findOneForUser's own scoping).
 */
export function StudentProfile({
  studentId,
  canUploadPhoto = false,
  canViewFees = false,
  canEditGuardianEmail = false,
}: {
  studentId: string;
  canUploadPhoto?: boolean;
  canViewFees?: boolean;
  canEditGuardianEmail?: boolean;
}) {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { termId } = useCurrentTerm();
  const [components, setComponents] = useState<AssessmentComponentOption[]>([]);

  const load = useCallback(() => {
    apiFetch<StudentDetail>(`/students/${studentId}`, { auth: true })
      .then(setStudent)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load student"));
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolves this term's Mid-Term/Exam `AssessmentComponent` for the
  // student's own class-level category, so the quick-link buttons below can
  // jump straight to the right Planner tab+component instead of landing on
  // a blank "pick a term" screen. Either (or both) may not exist yet if
  // Admin hasn't defined this term's structure for that category — those
  // buttons are simply omitted rather than linking somewhere empty.
  const category = student?.currentClass?.classLevel.category;
  useEffect(() => {
    if (!termId || !category) {
      setComponents([]);
      return;
    }
    apiFetch<AssessmentComponentOption[]>(`/assessment-components?termId=${termId}&classLevelCategory=${category}`, {
      auth: true,
    })
      .then((all) => setComponents(all.filter((c) => c.type === "MID_TERM" || c.type === "EXAM")))
      .catch(() => setComponents([]));
  }, [termId, category]);
  const midTermComponent = components.find((c) => c.type === "MID_TERM");
  const examComponent = components.find((c) => c.type === "EXAM");

  return (
    <div className="space-y-4">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-[12.5px] text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to students
      </Link>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !student && <p className="text-sm text-muted">Loading…</p>}

      {student && (
        <>
          <Card>
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border bg-card-inset">
                  {student.user.avatarUrl ? (
                    <img src={student.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon className="h-8 w-8 text-muted" />
                  )}
                </div>
                {canUploadPhoto && (
                  <PhotoUploadButton
                    studentId={student.id}
                    label={`Upload photo for ${student.user.firstName} ${student.user.lastName}`}
                    iconClassName="h-4 w-4"
                    onUploaded={load}
                  />
                )}
              </div>

              <div className="flex-1 space-y-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">
                    {student.user.firstName} {student.user.middleName ? `${student.user.middleName} ` : ""}
                    {student.user.lastName}
                  </h2>
                  <p className="font-mono text-[12px] text-muted">{student.admissionNumber}</p>
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted">Status</dt>
                    <dd className="mt-0.5">
                      <Badge variant={STATUS_VARIANT[student.status] ?? "muted"}>{student.status}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted">Gender</dt>
                    <dd className="mt-0.5">{student.user.gender ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted">Class</dt>
                    <dd className="mt-0.5">
                      {student.currentClass
                        ? `${student.currentClass.classLevel.name} ${student.currentClass.name}`
                        : "—"}
                    </dd>
                  </div>
                  {student.studentTitle && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Title</dt>
                      <dd className="mt-0.5">{student.studentTitle}</dd>
                    </div>
                  )}
                  {student.currentClass?.classLevel.category === "SSS" && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Department</dt>
                      <dd className="mt-0.5">{student.departmentHistory[0]?.department.name ?? "Not assigned"}</dd>
                    </div>
                  )}
                  {student.bloodGroup && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Blood group</dt>
                      <dd className="mt-0.5">{student.bloodGroup}</dd>
                    </div>
                  )}
                  {student.medicalNotes && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Medical notes</dt>
                      <dd className="mt-0.5">{student.medicalNotes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="This term" sub="Jumps straight to the current term's records for this student" />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/report-cards?studentId=${student.id}`}>Report card</Link>
              </Button>
              {student.currentClass && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/planner?tab=class-timetable&classArmId=${student.currentClass.id}`}>Class timetable</Link>
                </Button>
              )}
              {student.currentClass && midTermComponent && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/planner?tab=exam-timetable&classArmId=${student.currentClass.id}&assessmentComponentId=${midTermComponent.id}`}
                  >
                    Mid-term timetable
                  </Link>
                </Button>
              )}
              {student.currentClass && examComponent && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/planner?tab=exam-timetable&classArmId=${student.currentClass.id}&assessmentComponentId=${examComponent.id}`}
                  >
                    Exam timetable
                  </Link>
                </Button>
              )}
              {canViewFees && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/fees?studentId=${student.id}`}>Fees</Link>
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Guardians" />
            {student.guardians.length === 0 ? (
              <p className="text-sm text-muted">No guardians on file.</p>
            ) : (
              <div className="space-y-2.5">
                {student.guardians.map((guardian) => (
                  <div key={guardian.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {guardian.parent.user.firstName} {guardian.parent.user.lastName}
                      </span>
                      <Badge variant="muted">{guardian.relationship}</Badge>
                      {guardian.isPrimaryContact && <Badge variant="info">Primary</Badge>}
                      {guardian.isEmergencyContact && <Badge variant="warning">Emergency</Badge>}
                    </div>
                    <p className="mt-1 text-[12px] text-muted">
                      {guardian.parent.user.email}
                      {guardian.parent.user.phone ? ` · ${guardian.parent.user.phone}` : ""}
                    </p>
                    {guardian.parent.address && (
                      <p className="mt-0.5 text-[12px] text-muted">{guardian.parent.address}</p>
                    )}
                    {canEditGuardianEmail && !guardian.parent.emailChangedByStaffAt && (
                      <div className="mt-1.5">
                        <GuardianEmailChangeAction parentProfileId={guardian.parent.id} onChanged={load} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * One-time email correction/confirmation (PATCH /parent-profiles/:id/email)
 * — mainly for guardians onboarded via the legacy CSV import who often
 * start with a synthetic placeholder address. Setting a real email here is
 * what actually sends the parent a password-reset email; the control is
 * hidden once ParentProfile.emailChangedByStaffAt is set (a second attempt
 * is also rejected server-side).
 */
function GuardianEmailChangeAction({ parentProfileId, onChanged }: { parentProfileId: string; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/parent-profiles/${parentProfileId}/email`, {
        method: "PATCH",
        auth: true,
        body: { email },
      });
      setOpen(false);
      setEmail("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change email…
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="text-lg font-semibold">Change guardian email</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-sm text-muted">
          This can only be done once for this guardian. Setting it sends them an email to set their
          password.
        </AlertDialogDescription>
        <div className="mt-3">
          <FormField
            label="New email"
            id={`guardian-email-${parentProfileId}`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          {/* Plain Button, not AlertDialogAction — Action auto-closes on click,
              which would hide a failed-request error before the user reads it. */}
          <Button onClick={handleConfirm} disabled={submitting || !email}>
            {submitting ? "Saving…" : "Confirm change"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
