"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { User as UserIcon } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { PhotoUploadButton } from "../molecules/photo-upload-button";

interface StudentListItem {
  id: string;
  admissionNumber: string;
  status: string;
  currentClassId: string | null;
  currentClass: { name: string; classLevel: { name: string } } | null;
  user: { firstName: string; lastName: string; avatarUrl: string | null };
  guardians: { parent: { user: { phone: string | null } } }[];
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  GRADUATED: "info",
  WITHDRAWN: "muted",
  SUSPENDED: "danger",
};

/**
 * Renders whatever `GET /students` returns — the API already applies PRD §5's
 * row-level scoping (all students for Admin/Super-Admin, own class for a
 * class/subject teacher, own wards for a parent, self for a student), so
 * this component doesn't branch on role at all. `canUploadPhoto` gates the
 * per-row passport-photo control separately — the caller passes Admin/
 * Super-Admin OR an active CLASS_TEACHER assignment (students/page.tsx);
 * the real per-class authorization is enforced server-side regardless
 * (StudentService.uploadPhoto).
 */
export function PeopleList({
  refreshKey,
  canUploadPhoto = false,
  canEdit = false,
  onEdit,
}: {
  refreshKey?: unknown;
  canUploadPhoto?: boolean;
  canEdit?: boolean;
  onEdit?: (id: string) => void;
}) {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    apiFetch<StudentListItem[]>("/students", { auth: true })
      .then(setStudents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load students"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filteredStudents = useMemo(() => {
    if (!students) return students;
    const term = search.trim().toLowerCase();
    if (!term) return students;
    return students.filter(
      (student) =>
        student.admissionNumber.toLowerCase().includes(term) ||
        `${student.user.firstName} ${student.user.lastName}`.toLowerCase().includes(term),
    );
  }, [students, search]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!students) return <p className="text-sm text-muted">Loading…</p>;
  if (students.length === 0) return <p className="text-sm text-muted">No students visible to you yet.</p>;

  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search by name or admission number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search students"
      />
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Admission #</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Name</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Class</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Parent phone</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
            </tr>
          </thead>
          <tbody>
            {filteredStudents?.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-muted">
                  No students match &ldquo;{search}&rdquo;.
                </td>
              </tr>
            )}
            {filteredStudents?.map((student) => (
              <tr key={student.id} className="border-b border-border/60 last:border-none">
                <td className="py-2.5 pr-4 font-mono text-muted">{student.admissionNumber}</td>
                <td className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {student.user.avatarUrl ? (
                      <img
                        src={student.user.avatarUrl}
                        alt=""
                        className="h-3.5 w-3.5 flex-none rounded-full border border-border object-cover"
                      />
                    ) : (
                      <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border border-border bg-card-inset text-muted">
                        <UserIcon className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {student.user.firstName} {student.user.lastName}
                    {canUploadPhoto && (
                      <PhotoUploadButton
                        studentId={student.id}
                        label={`Upload photo for ${student.user.firstName} ${student.user.lastName}`}
                      />
                    )}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted">
                  {student.currentClass
                    ? `${student.currentClass.classLevel.name} ${student.currentClass.name}`
                    : "—"}
                </td>
                <td className="py-2.5 pr-4 font-mono text-muted">{student.guardians[0]?.parent.user.phone ?? "—"}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant={STATUS_VARIANT[student.status] ?? "muted"}>{student.status}</Badge>
                </td>
                <td className="py-2.5 text-right">
                  <span className="inline-flex gap-1.5">
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={() => onEdit?.(student.id)}>
                        Edit
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/students/${student.id}`}>View</Link>
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
