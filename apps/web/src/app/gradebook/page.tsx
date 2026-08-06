"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { Badge, type BadgeVariant } from "../../components/atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { GradebookTable } from "../../components/organisms/gradebook-table";

interface ClassArmOption {
  id: string;
  name: string;
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
type ComponentStatus = "DRAFT" | "OPEN" | "CLOSED" | "PUBLISHED";
interface AssessmentComponentOption {
  id: string;
  name: string;
  maxScore: number;
  status: ComponentStatus;
}

const STATUS_VARIANT: Record<ComponentStatus, BadgeVariant> = {
  DRAFT: "muted",
  OPEN: "success",
  CLOSED: "warning",
  PUBLISHED: "info",
};

export default function GradebookPage() {
  const { user, loading, logout } = useCurrentUser();
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);

  const [classArmId, setClassArmId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [termId, setTermId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [components, setComponents] = useState<AssessmentComponentOption[] | null>(null);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setMyAssignments)
      .catch(() => setMyAssignments([]));
  }, []);

  const isAdmin = user ? user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") : false;

  // A non-admin only ever sees the class arms / subjects their own active
  // SUBJECT_TEACHER assignments cover — not the full school catalogue.
  const mySubjectTeacherAssignments = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive),
    [myAssignments],
  );

  const classArmOptions = isAdmin
    ? classArms
    : classArms.filter((arm) => mySubjectTeacherAssignments.some((a) => a.classArmId === arm.id));

  // A "group" subject (e.g. Basic Science and Technology) is never itself
  // scored — its child subjects (Basic Science, Basic Technology, …) are,
  // each independently. The parent's aggregate is computed at report-card
  // time from SubjectGroupWeight, not entered directly here. Mirrors the
  // same flattening in staff-assignment-form.tsx's Subject select.
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

  useEffect(() => {
    const classLevelCategory = classArms.find((a) => a.id === classArmId)?.classLevel.category;
    if (!classLevelCategory || !termId) {
      setComponents(null);
      return;
    }
    apiFetch<AssessmentComponentOption[]>(
      `/assessment-components?termId=${termId}&classLevelCategory=${classLevelCategory}`,
      { auth: true },
    )
      .then((fetched) => setComponents(isAdmin ? fetched : fetched.filter((c) => c.status === "OPEN")))
      .catch(() => setComponents([]));
  }, [classArmId, termId, classArms, isAdmin]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canEnter = isAdmin || mySubjectTeacherAssignments.length > 0;
  const selectedComponent = components?.find((c) => c.id === componentId) ?? null;

  if (!canEnter) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Assessment · Gradebook" title="Gradebook" />
        <Card>
          <p className="text-sm text-muted">You have no active subject-teacher assignment to enter scores for.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Gradebook" title="Gradebook" />

      <Card className="mb-4">
        <CardHeader
          title="Select class, subject, term, and component"
          sub={isAdmin ? "Admin override — any status is selectable" : "Only components currently OPEN for entry are shown"}
        />
        <div className="grid grid-cols-4 gap-4">
          <div>
            <Label htmlFor="gb-class-arm">Class arm</Label>
            <Select
              value={classArmId}
              onValueChange={(v) => {
                setClassArmId(v);
                setSubjectId("");
                setComponentId("");
              }}
            >
              <SelectTrigger id="gb-class-arm" className="mt-1">
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classArmOptions.map((arm) => (
                  <SelectItem key={arm.id} value={arm.id}>
                    {arm.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="gb-subject">Subject</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger id="gb-subject" className="mt-1">
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {subjectOptions.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="gb-term">Term</Label>
            <Select
              value={termId}
              onValueChange={(v) => {
                setTermId(v);
                setComponentId("");
              }}
            >
              <SelectTrigger id="gb-term" className="mt-1">
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
          <div>
            <Label htmlFor="gb-component">Component</Label>
            <Select value={componentId} onValueChange={setComponentId}>
              <SelectTrigger id="gb-component" className="mt-1">
                <SelectValue placeholder="Select component" />
              </SelectTrigger>
              <SelectContent>
                {components?.map((component) => (
                  <SelectItem key={component.id} value={component.id}>
                    {component.name} ({component.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {components && components.length === 0 && (
          <p className="mt-2 text-[11.5px] text-muted">
            No {isAdmin ? "" : "open "}assessment components for this term/class yet.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Score entry"
          sub={selectedComponent ? <Badge variant={STATUS_VARIANT[selectedComponent.status]}>{selectedComponent.status}</Badge> : undefined}
        />
        {classArmId && subjectId && componentId && selectedComponent ? (
          <GradebookTable
            classArmId={classArmId}
            subjectId={subjectId}
            assessmentComponentId={componentId}
            maxScore={selectedComponent.maxScore}
            readOnly={!isAdmin && selectedComponent.status !== "OPEN"}
          />
        ) : (
          <p className="text-sm text-muted">Select a class, subject, term, and component above to begin.</p>
        )}
      </Card>
    </AppShell>
  );
}
