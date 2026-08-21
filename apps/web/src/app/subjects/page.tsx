"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { SubjectList, type SubjectListItem } from "../../components/organisms/subject-list";
import { CreateSubjectForm, type EditableSubject } from "../../components/organisms/create-subject-form";
import { ClassSubjectAssignment } from "../../components/organisms/class-subject-assignment";
import { StudentDepartmentForm } from "../../components/organisms/student-department-form";
import { StudentSubjectEnrollmentManager } from "../../components/organisms/student-subject-enrollment-manager";

export default function SubjectsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [editingSubject, setEditingSubject] = useState<EditableSubject | null>(null);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  // Matches the backend CASL grant: Principal/Headteacher get `manage
  // Subject/ClassSubject/StudentDepartment` too (ability.factory.ts).
  const canManage =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));

  function handleEdit(subject: SubjectListItem) {
    setEditingSubject({
      id: subject.id,
      name: subject.name,
      code: subject.code,
      requiresCalculation: subject.requiresCalculation,
      isGroup: subject.isGroup,
      classSubjects: subject.classSubjects,
    });
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Subjects" title="Subjects" />

      <div className="space-y-4">
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
          <CollapsibleCard title="Subject catalogue">
            <SubjectList canManage={canManage} onEdit={handleEdit} />
          </CollapsibleCard>

          {canManage && (
            <CollapsibleCard
              title={editingSubject ? `Edit ${editingSubject.name}` : "Create subject"}
              sub={
                editingSubject
                  ? editingSubject.isGroup
                    ? "Child subjects can be edited, disabled, or added to below"
                    : undefined
                  : "Including grouped subjects with independently-scored children"
              }
            >
              <CreateSubjectForm
                editingSubject={editingSubject}
                onEditSaved={() => setEditingSubject(null)}
                onCancelEdit={() => setEditingSubject(null)}
              />
            </CollapsibleCard>
          )}
        </div>

        {canManage && (
          <CollapsibleCard title="Assign subjects to a class" sub="Per class group">
            <ClassSubjectAssignment />
          </CollapsibleCard>
        )}

        {canManage && (
          <CollapsibleCard
            title="Student departments"
            sub="SSS-only — required for department-restricted subjects"
          >
            <StudentDepartmentForm />
          </CollapsibleCard>
        )}

        {canManage && (
          <CollapsibleCard
            title="Student subject enrollment"
            sub="Opt a student into (or drop them from) a General/Department-restricted subject — Compulsory subjects auto-enroll on class assignment"
          >
            <StudentSubjectEnrollmentManager />
          </CollapsibleCard>
        )}
      </div>
    </AppShell>
  );
}
