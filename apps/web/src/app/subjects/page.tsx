"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { SubjectList } from "../../components/organisms/subject-list";
import { CreateSubjectForm } from "../../components/organisms/create-subject-form";
import { ClassSubjectAssignment } from "../../components/organisms/class-subject-assignment";
import { StudentDepartmentForm } from "../../components/organisms/student-department-form";

export default function SubjectsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canManage = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Subjects" title="Subjects" />

      <div className="space-y-4">
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Subject catalogue" />
            <SubjectList refreshKey={refreshKey} />
          </Card>

          {canManage && (
            <Card>
              <CardHeader title="Create subject" sub="Including grouped subjects with independently-scored children" />
              <CreateSubjectForm onCreated={() => setRefreshKey((k) => k + 1)} />
            </Card>
          )}
        </div>

        {canManage && (
          <Card>
            <CardHeader title="Assign subjects to a class" sub="Per class level, per academic session" />
            <ClassSubjectAssignment />
          </Card>
        )}

        {canManage && (
          <Card>
            <CardHeader title="Student departments" sub="SSS-only — required for department-restricted subjects" />
            <StudentDepartmentForm />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
