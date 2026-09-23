"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, User as UserIcon, X } from "lucide-react";
import { formatPersonName, type ClassLevelCategory } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "../molecules/dialog";
import { PhotoUploadButton } from "../molecules/photo-upload-button";

interface ClassLevelOption {
  id: string;
  name: string;
  order: number;
  category: ClassLevelCategory;
}

interface StaffAssignmentMineItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  classArm: { id: string; name: string; classLevel: { name: string; order: number } } | null;
}

interface MyClassArm {
  id: string;
  name: string;
  classLevel: { name: string; order: number };
  isClassTeacher: boolean;
}

interface StudentListItem {
  id: string;
  admissionNumber: string;
  status: string;
  currentClassId: string | null;
  currentClass: { name: string; classLevel: { name: string } } | null;
  user: { firstName: string; lastName: string; avatarUrl: string | null };
  guardians: { parent: { user: { phone: string | null } } }[];
  subjectEnrollments: { subject: { id: string; name: string; code: string } }[];
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  GRADUATED: "info",
  WITHDRAWN: "muted",
  SUSPENDED: "danger",
};

// Subjects come back already sorted ascending by name (STUDENT_LIST_INCLUDE_WITH_SUBJECTS'
// orderBy) — only the first few render inline so a student enrolled in a
// dozen subjects doesn't blow out the row height; the rest are one click
// away in a dialog rather than scrolling the whole table sideways.
const INLINE_SUBJECT_LIMIT = 3;

function SubjectsCell({
  studentName,
  subjects,
}: {
  studentName: string;
  subjects: { id: string; name: string; code: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (subjects.length === 0) return <span className="text-muted">—</span>;

  const visible = subjects.slice(0, INLINE_SUBJECT_LIMIT);
  const remaining = subjects.length - visible.length;

  return (
    <>
      <span className="flex max-w-[220px] flex-wrap items-center gap-1">
        {visible.map((subject) => (
          <span key={subject.id} className="rounded-full bg-card-inset px-1.5 py-0.5 text-[10px] text-muted">
            {subject.name}
          </span>
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-card-inset"
          >
            +{remaining} more
          </button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <div className="mb-4 flex items-center justify-between">
            <DialogTitle className="font-display text-lg">{studentName} — Subjects</DialogTitle>
            <DialogClose asChild>
              <button type="button" aria-label="Close" className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
          <ul className="max-h-[300px] space-y-1.5 overflow-y-auto">
            {subjects.map((subject, index) => (
              <li
                key={subject.id}
                className="flex items-center justify-between rounded-md bg-card-inset px-3 py-1.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right font-mono text-[10px] text-muted">{index + 1}.</span>
                  <span>{subject.name}</span>
                </span>
                <span className="font-mono text-[10px] text-muted">{subject.code}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
  user,
  refreshKey,
  canUploadPhoto = false,
  canEdit = false,
  onEdit,
}: {
  user: CurrentUser;
  refreshKey?: unknown;
  canUploadPhoto?: boolean;
  canEdit?: boolean;
  onEdit?: (id: string) => void;
}) {
  const { data: classLevels = [] } = useQuery({
    queryKey: ["class-levels"],
    queryFn: () => apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }),
  });
  const [classLevelId, setClassLevelId] = useState("");

  // Only a plain class/subject teacher is scoped by class-arm assignment
  // (StudentService.scopeWhereForUser) — Super-Admin/Admin see everyone,
  // REGISTRAR/BURSAR are school-wide, and PRINCIPAL/VICE_PRINCIPAL/
  // HEADTEACHER are scoped to a whole section (resolvePrincipalHeadteacherCategories),
  // not to specific arms — none of those need this filter, and a user
  // holding one of those titles alongside a CLASS_TEACHER/SUBJECT_TEACHER
  // assignment is still unscoped by the wider title, same precedence as
  // scopeWhereForUser itself.
  const isSchoolOrSectionScoped =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    user.assignmentTypes.includes("REGISTRAR") ||
    user.assignmentTypes.includes("BURSAR") ||
    user.assignmentTypes.includes("PRINCIPAL") ||
    user.assignmentTypes.includes("VICE_PRINCIPAL") ||
    user.assignmentTypes.includes("HEADTEACHER");

  // Class/subject teachers are already row-scoped to their own class arms
  // server-side — this filter just lets them narrow that scope down to one
  // arm at a time, defaulting to the arm they're CLASS_TEACHER for (or their
  // first taught arm if they're only a SUBJECT_TEACHER), same
  // "/staff-assignments/mine, filter by isActive" pattern as
  // class-teacher-additions.tsx.
  const { data: myAssignments } = useQuery({
    queryKey: ["staff-assignments", "mine"],
    queryFn: () => apiFetch<StaffAssignmentMineItem[]>("/staff-assignments/mine", { auth: true }),
    enabled: Boolean(user.staffProfileId) && !isSchoolOrSectionScoped,
  });

  const myClassArms = useMemo(() => {
    const byId = new Map<string, MyClassArm>();
    for (const a of myAssignments ?? []) {
      if (!a.isActive || !a.classArmId || !a.classArm) continue;
      if (a.assignmentType !== "CLASS_TEACHER" && a.assignmentType !== "SUBJECT_TEACHER") continue;
      const isClassTeacher = a.assignmentType === "CLASS_TEACHER";
      const existing = byId.get(a.classArmId);
      if (existing) {
        existing.isClassTeacher = existing.isClassTeacher || isClassTeacher;
      } else {
        byId.set(a.classArmId, {
          id: a.classArmId,
          name: a.classArm.name,
          classLevel: { name: a.classArm.classLevel.name, order: a.classArm.classLevel.order },
          isClassTeacher,
        });
      }
    }
    return [...byId.values()].sort(
      (x, y) => x.classLevel.order - y.classLevel.order || x.name.localeCompare(y.name),
    );
  }, [myAssignments]);

  const [classArmId, setClassArmId] = useState("");
  const defaultArmApplied = useRef(false);

  useEffect(() => {
    const [firstArm] = myClassArms;
    if (defaultArmApplied.current || !firstArm) return;
    defaultArmApplied.current = true;
    const classTeacherArm = myClassArms.find((arm) => arm.isClassTeacher);
    setClassArmId((classTeacherArm ?? firstArm).id);
  }, [myClassArms]);

  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [nameSort, setNameSort] = useState<"asc" | "desc">("asc");

  // Sequence-guarded: the class-arm default (above) fires a second, filtered
  // fetch shortly after the unfiltered one this effect kicks off on mount —
  // without this guard, a slower unfiltered response can land after the
  // filtered one and silently overwrite it with the wrong roster.
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams({ includeSubjects: "true" });
    if (classLevelId) params.set("classLevelId", classLevelId);
    if (classArmId) params.set("classArmId", classArmId);
    apiFetch<StudentListItem[]>(`/students?${params}`, { auth: true })
      .then((data) => {
        if (seq === loadSeq.current) setStudents(data);
      })
      .catch((err) => {
        if (seq === loadSeq.current) setError(err instanceof ApiError ? err.message : "Failed to load students");
      });
  }, [classLevelId, classArmId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filteredStudents = useMemo(() => {
    if (!students) return students;
    const term = search.trim().toLowerCase();
    const filtered = students.filter((student) => {
      const matchesTerm =
        !term ||
        student.admissionNumber.toLowerCase().includes(term) ||
        formatPersonName(student.user).toLowerCase().includes(term);
      const matchesStatus = !statusFilter || student.status === statusFilter;
      return matchesTerm && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const cmp = formatPersonName(a.user).localeCompare(formatPersonName(b.user));
      return nameSort === "asc" ? cmp : -cmp;
    });
  }, [students, search, statusFilter, nameSort]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!students) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          placeholder="Search by name or admission number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search students"
          className="sm:flex-1"
        />
        {myClassArms.length > 0 && (
          <Select value={classArmId || "ALL"} onValueChange={(v) => setClassArmId(v === "ALL" ? "" : v)}>
            <SelectTrigger className="sm:w-48" aria-label="Filter by class arm">
              <SelectValue placeholder="My classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All my classes</SelectItem>
              {myClassArms.map((arm) => (
                <SelectItem key={arm.id} value={arm.id}>
                  {arm.classLevel.name} {arm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={classLevelId || "ALL"} onValueChange={(v) => setClassLevelId(v === "ALL" ? "" : v)}>
          <SelectTrigger className="sm:w-56" aria-label="Filter by class level">
            <SelectValue placeholder="All class levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All class levels</SelectItem>
            {classLevels.map((level) => (
              <SelectItem key={level.id} value={level.id}>
                {level.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="GRADUATED">Graduated</SelectItem>
            <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {students.length === 0 ? (
        <p className="text-sm text-muted">
          {classLevelId ? "No students in this class level." : "No students visible to you yet."}
        </p>
      ) : (
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">S/N</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Admission #</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">
                <button
                  type="button"
                  onClick={() => setNameSort((d) => (d === "asc" ? "desc" : "asc"))}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                >
                  Name
                  {nameSort === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Class</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Subjects</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Parent phone</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
            </tr>
          </thead>
          <tbody>
            {filteredStudents?.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3 text-muted">
                  No students match the current filters.
                </td>
              </tr>
            )}
            {filteredStudents?.map((student, index) => (
              <tr key={student.id} className="border-b border-border/60 last:border-none even:bg-card-inset">
                <td className="py-2.5 pr-4 text-muted">{index + 1}</td>
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
                    {formatPersonName(student.user)}
                    {canUploadPhoto && (
                      <PhotoUploadButton
                        studentId={student.id}
                        label={`Upload photo for ${formatPersonName(student.user)}`}
                      />
                    )}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted">
                  {student.currentClass
                    ? `${student.currentClass.classLevel.name} ${student.currentClass.name}`
                    : "—"}
                </td>
                <td className="py-2.5 pr-4">
                  <SubjectsCell
                    studentName={formatPersonName(student.user)}
                    subjects={student.subjectEnrollments.map((e) => e.subject)}
                  />
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
      )}
    </div>
  );
}
