"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { ClassTeacherSkillsPanel } from "../../components/organisms/class-teacher-skills-panel";
import { SubjectCommentPanel } from "../../components/organisms/subject-comment-panel";
import { PrincipalCommentPanel } from "../../components/organisms/principal-comment-panel";

interface ClassArmOption {
  id: string;
  name: string;
  classLevelId: string;
}
interface SubjectOption {
  id: string;
  name: string;
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
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true })
      .then(setMyAssignments)
      .catch(() => setMyAssignments([]));
  }, []);

  const isAdmin = user ? user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") : false;

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
  const subjectSubjectOptions = isAdmin
    ? subjects
    : subjects.filter((subject) => mySubjectTeacherAssignments.some((a) => a.subjectId === subject.id));

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
        <Card className="mb-4">
          <CardHeader
            title="Skill ratings & class-teacher comment"
            sub="Only editable while the class level's report window is OPEN"
          />
          <ClassTeacherSkillsPanel classArmOptions={classTeacherClassArmOptions} terms={terms} isAdmin={isAdmin} />
        </Card>
      )}

      {showSubjectSection && (
        <Card className="mb-4">
          <CardHeader
            title="Subject comment"
            sub="Opens once every assessment component for the term/class level has closed"
          />
          <SubjectCommentPanel
            classArmOptions={subjectClassArmOptions}
            subjectOptions={subjectSubjectOptions}
            terms={terms}
          />
        </Card>
      )}

      {showPrincipalSection && (
        <Card>
          <CardHeader title="Principal / Headteacher comment" sub="Available for any student, any time" />
          <PrincipalCommentPanel terms={terms} />
        </Card>
      )}
    </AppShell>
  );
}
