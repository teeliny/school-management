"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, User as UserIcon } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Card, CardHeader } from "../molecules/card";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { PhotoUploadButton } from "../molecules/photo-upload-button";

interface Guardian {
  id: string;
  relationship: string;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  parent: {
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
  currentClass: { name: string; classLevel: { name: string } } | null;
  user: {
    firstName: string;
    lastName: string;
    middleName: string | null;
    gender: string | null;
    avatarUrl: string | null;
  };
  guardians: Guardian[];
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  GRADUATED: "info",
  WITHDRAWN: "muted",
  SUSPENDED: "danger",
};

/**
 * Full detail view for one student — reached via the "View" button on the
 * PeopleList row (students/page.tsx). `canUploadPhoto` mirrors the same
 * Admin/Super-Admin-or-CLASS_TEACHER gate the list uses; the real per-class
 * authorization is enforced server-side (StudentService.uploadPhoto).
 */
export function StudentProfile({ studentId, canUploadPhoto = false }: { studentId: string; canUploadPhoto?: boolean }) {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<StudentDetail>(`/students/${studentId}`, { auth: true })
      .then(setStudent)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load student"));
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

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
