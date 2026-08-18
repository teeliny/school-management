"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { ClassTeacherSkillsPanel } from "../../components/organisms/class-teacher-skills-panel";
import { SubjectCommentPanel } from "../../components/organisms/subject-comment-panel";
import { PrincipalCommentPanel } from "../../components/organisms/principal-comment-panel";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: string };
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface StaffAssignmentItem {
  assignmentType: string;
  classArmId: string | null;
  subjectId: string | null;
  isActive: boolean;
}

export default function SkillsCommentsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setMyAssignments)
      .catch(() => setMyAssignments([]));
  }, []);

  // Matches the backend CASL grant: Principal/Headteacher get `manage
  // SkillRating/ReportComment` too (ability.factory.ts) — the same
  // outside-OPEN-window override this flag already grants Admin below.
  const isAdmin = user
    ? user.roles.includes("SUPER_ADMIN") ||
      user.roles.includes("ADMIN") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t))
    : false;

  const myClassTeacherAssignments = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "CLASS_TEACHER" && a.isActive),
    [myAssignments],
  );
  const mySubjectTeacherAssignments = useMemo(
    () => myAssignments.filter((a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive),
    [myAssignments],
  );

  const showClassTeacherSection = isAdmin || myClassTeacherAssignments.length > 0;
  const showSubjectSection = isAdmin || mySubjectTeacherAssignments.length > 0;
  const showPrincipalSection =
    isAdmin || (user ? ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t)) : false);

  const classTeacherClassArmOptions = isAdmin
    ? classArms
    : classArms.filter((arm) => myClassTeacherAssignments.some((a) => a.classArmId === arm.id));

  const subjectClassArmOptions = isAdmin
    ? classArms
    : classArms.filter((arm) => mySubjectTeacherAssignments.some((a) => a.classArmId === arm.id));

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  if (!showClassTeacherSection && !showSubjectSection && !showPrincipalSection) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Assessment · Skills & Comments" title="Skills & Comments" />
        <Card>
          <p className="text-sm text-muted">
            You have no active class-teacher, subject-teacher, or principal/headteacher assignment.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Skills & Comments" title="Skills & Comments" />

      {showClassTeacherSection && (
        <CollapsibleCard
          title="Skill ratings & class-teacher comment"
          sub="Only editable while the class level's report window is OPEN"
          className="mb-4"
        >
          <ClassTeacherSkillsPanel classArmOptions={classTeacherClassArmOptions} terms={terms} isAdmin={isAdmin} />
        </CollapsibleCard>
      )}

      {showSubjectSection && (
        <CollapsibleCard
          title="Subject comment"
          sub="Opens once every assessment component for the term/class level has closed"
          className="mb-4"
        >
          <SubjectCommentPanel
            classArmOptions={subjectClassArmOptions}
            terms={terms}
            isAdmin={isAdmin}
            mySubjectTeacherAssignments={mySubjectTeacherAssignments}
          />
        </CollapsibleCard>
      )}

      {showPrincipalSection && (
        <CollapsibleCard title="Principal / Headteacher comment" sub="Available for any student, any time">
          <PrincipalCommentPanel classArmOptions={classArms} terms={terms} />
        </CollapsibleCard>
      )}
    </AppShell>
  );
}
