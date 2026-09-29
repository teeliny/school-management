"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Plus } from "lucide-react";
import { formatPersonName, sectionLeadCategories, type ClassLevelCategory } from "@school/types";
import { useCurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { useParentChildren } from "../../lib/use-parent-children";
import { apiFetch } from "../../lib/api";
import { formatDueDate, type HomeworkListItem } from "../../lib/homework";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { EmptyState } from "../../components/molecules/empty-state";
import { Label } from "../../components/atoms/label";
import { Badge } from "../../components/atoms/badge";
import { Button } from "../../components/atoms/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { SearchableSelect } from "../../components/molecules/searchable-select";
import { Tabs, TabsList, TabsTrigger } from "../../components/molecules/tabs";
import { HomeworkForm } from "../../components/organisms/homework-form";
import { HomeworkDetail, HOMEWORK_STATUS_VARIANT } from "../../components/organisms/homework-detail";
import { WardHomeworkList } from "../../components/organisms/ward-homework-list";
import { cn } from "../../lib/cn";

interface ClassArmOption {
  id: string;
  displayName: string;
  classLevelId: string;
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

const ALL = "all";

export default function AssignmentsPage() {
  const { user, loading, logout } = useCurrentUser();
  const children = useParentChildren(user?.parentProfileId ?? null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  if (loading) return <PageLoadingSkeleton />;
  if (!user) return null;

  const isAdmin = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  const isStaffViewer =
    isAdmin ||
    ["SUBJECT_TEACHER", "CLASS_TEACHER", "PRINCIPAL", "HEADTEACHER", "VICE_PRINCIPAL"].some((t) => user.assignmentTypes.includes(t));
  const activeChild = children?.find((c) => c.id === selectedChildId) ?? children?.[0] ?? null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Assignments" title="Assignments" />

      {isStaffViewer && (
        <StaffAssignments isAdmin={isAdmin} sectionCategories={isAdmin ? null : sectionLeadCategories(user.assignmentTypes)} />
      )}

      {user.parentProfileId && children && children.length > 0 && activeChild && (
        <Card className="mt-4">
          <CardHeader title="My children's assignments" sub="Published by subject teachers — marks and corrections appear here once marked" />
          {children.length > 1 && (
            <Tabs value={activeChild.id} onValueChange={setSelectedChildId} className="mb-3">
              <TabsList>
                {children.map((child) => (
                  <TabsTrigger key={child.id} value={child.id}>
                    {formatPersonName(child.user)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <WardHomeworkList studentId={activeChild.id} />
        </Card>
      )}

      {user.studentProfileId && (
        <Card className="mt-4">
          <CardHeader title="My assignments" />
          <WardHomeworkList studentId={user.studentProfileId} />
        </Card>
      )}
    </AppShell>
  );
}

/**
 * Staff side: a subject teacher creates/marks homework for their own
 * subject+class pairs; Admin/Super-Admin can for any. Class teachers and
 * Principal/Headteacher/VP see what's been set (read-only — the API's
 * list is already scoped to what each viewer may see).
 */
function StaffAssignments({
  isAdmin,
  sectionCategories,
}: {
  isAdmin: boolean;
  // Principal/VP → JSS/SSS, Headteacher → Creche–Primary; null otherwise.
  sectionCategories: ClassLevelCategory[] | null;
}) {
  const { termId: currentTermId } = useCurrentTerm();
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);

  const [classArmId, setClassArmId] = useState(ALL);
  const [subjectId, setSubjectId] = useState("");
  const [termId, setTermId] = useState("");
  const [items, setItems] = useState<HomeworkListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setMyAssignments)
      .catch(() => setMyAssignments([]));
  }, []);

  useEffect(() => {
    if (!termId && currentTermId) setTermId(currentTermId);
  }, [currentTermId, termId]);

  const subjectTeacherPairs = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive),
    [myAssignments],
  );
  const selectedArm = classArms.find((a) => a.id === classArmId);
  // Class arms: Admin sees every arm; a section lead sees their section's
  // arms plus any arm they personally teach; a plain teacher only the arms
  // they teach or class-teach. The API list is scoped the same way.
  const classArmOptions = classArms.filter(
    (arm) =>
      isAdmin ||
      sectionCategories?.includes(arm.classLevel.category as ClassLevelCategory) ||
      myAssignments.some((a) => a.isActive && a.classArmId === arm.id),
  );
  const armInSection = Boolean(selectedArm && sectionCategories?.includes(selectedArm.classLevel.category as ClassLevelCategory));

  // Same group-subject flattening as gradebook/page.tsx — a group subject
  // is never itself assignable (CLAUDE.md), only its children. Scoped by
  // classLevelId so a subject disabled for this ClassLevel isn't offered.
  useEffect(() => {
    setSubjectId("");
    if (!selectedArm) {
      setSubjects([]);
      return;
    }
    apiFetch<SubjectOption[]>(
      `/subjects?classLevelCategory=${selectedArm.classLevel.category}&classLevelId=${selectedArm.classLevelId}`,
      { auth: true },
    )
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, [selectedArm]);

  const flattenedSubjects = subjects.flatMap((subject) =>
    subject.isGroup && subject.childSubjects && subject.childSubjects.length > 0
      ? subject.childSubjects.map((child) => ({ id: child.id, name: `${child.name} (${subject.name})` }))
      : [{ id: subject.id, name: subject.name }],
  );
  // Every subject of the class: Super-Admin/Admin anywhere, a section lead
  // within their own section. Anyone else only sees the subjects they
  // personally teach in this class arm (a class teacher can still browse
  // the whole class's homework under "All subjects").
  const selectableSubjects =
    isAdmin || armInSection
      ? flattenedSubjects
      : flattenedSubjects.filter((subject) =>
          subjectTeacherPairs.some((a) => a.classArmId === classArmId && a.subjectId === subject.id),
        );

  const load = useCallback(() => {
    if (!termId) return;
    const params = new URLSearchParams({ termId });
    if (classArmId !== ALL) params.set("classArmId", classArmId);
    if (subjectId) params.set("subjectId", subjectId);
    apiFetch<HomeworkListItem[]>(`/homework?${params.toString()}`, { auth: true })
      .then(setItems)
      .catch(() => setItems([]));
  }, [termId, classArmId, subjectId]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const canCreateHere =
    Boolean(selectedArm && subjectId && termId) &&
    (isAdmin || subjectTeacherPairs.some((a) => a.classArmId === classArmId && a.subjectId === subjectId));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Filter"
          sub={isAdmin ? "Admin override — you can set and mark homework for any subject" : "Pick one of your classes and subjects to set new homework"}
          action={
            <Button type="button" size="sm" disabled={!canCreateHere} onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New assignment
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="hw-filter-arm">Class arm</Label>
            <Select
              value={classArmId}
              onValueChange={(v) => {
                setClassArmId(v);
                setSelectedId(null);
              }}
            >
              <SelectTrigger id="hw-filter-arm" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{isAdmin ? "All classes" : "All my classes"}</SelectItem>
                {classArmOptions.map((arm) => (
                  <SelectItem key={arm.id} value={arm.id}>
                    {arm.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="hw-filter-subject">Subject</Label>
            <SearchableSelect
              id="hw-filter-subject"
              value={subjectId}
              onValueChange={(v) => {
                setSubjectId(v);
                setSelectedId(null);
              }}
              options={[{ value: "", label: "All subjects" }, ...selectableSubjects.map((s) => ({ value: s.id, label: s.name }))]}
              placeholder={selectedArm ? "All subjects" : "Select a class arm first"}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="hw-filter-term">Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger id="hw-filter-term" className="mt-1">
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
        </div>
        {selectedArm && subjectId && !canCreateHere && (
          <p className="mt-2 text-[11.5px] text-muted">You can view homework here, but only the subject&apos;s assigned teacher can set new homework.</p>
        )}
      </Card>

      {creating && selectedArm && (
        <Card>
          <CardHeader title="New assignment" sub="Saved as a draft — publish it when you're ready for students and parents to see it" />
          <HomeworkForm
            target={{ subjectId, classArmId, termId, classLevelCategory: selectedArm.classLevel.category }}
            onSaved={(saved) => {
              setCreating(false);
              setSelectedId(saved.id);
              load();
            }}
            onCancel={() => setCreating(false)}
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader title="Homework" sub={items ? `${items.length} this term` : undefined} />
          {!items ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState icon={BookOpenCheck} title="No homework yet" description="Homework set for these filters will appear here." />
          ) : (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setCreating(false);
                    }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selectedId === item.id ? "border-primary bg-card-inset" : "border-border hover:bg-card-inset",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium">{item.title}</span>
                      <Badge variant={HOMEWORK_STATUS_VARIANT[item.status]}>{item.status}</Badge>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted">
                      {item.subject.name} · {item.classArm.classLevel.name} {item.classArm.name} · due{" "}
                      <span className="font-mono">{formatDueDate(item.dueDate)}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-muted">
                      {item._count.marks} marked
                      {item.allowOnlineSubmission && ` · ${item._count.submissions} submitted`}
                      {item.caComponent && ` · → ${item.caComponent.name}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {selectedId ? (
            <HomeworkDetail
              homeworkId={selectedId}
              onChanged={load}
              onDeleted={() => {
                setSelectedId(null);
                load();
              }}
            />
          ) : (
            <Card>
              <p className="text-sm text-muted">Select homework on the left to see details and mark it.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
