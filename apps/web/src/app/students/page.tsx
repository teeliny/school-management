"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { CreateStudentForm } from "../../components/organisms/create-student-form";
import { EditStudentForm } from "../../components/organisms/edit-student-form";
import { PeopleList } from "../../components/organisms/people-list";

export default function StudentsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  const canCreate =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    user.assignmentTypes.includes("REGISTRAR");
  const canUploadPhoto = canCreate || user.assignmentTypes.includes("CLASS_TEACHER");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Students" title="Students" />

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Students" sub="Scoped to what your role can see" />
          <PeopleList
            refreshKey={refreshKey}
            canUploadPhoto={canUploadPhoto}
            canEdit={canCreate}
            onEdit={setEditingStudentId}
          />
        </Card>

        {editingStudentId ? (
          <Card>
            <CardHeader title="Edit student" />
            <EditStudentForm
              studentId={editingStudentId}
              onSaved={() => {
                setEditingStudentId(null);
                setRefreshKey((k) => k + 1);
              }}
              onCancel={() => setEditingStudentId(null)}
            />
          </Card>
        ) : (
          canCreate && (
            <Card>
              <CardHeader title="Enroll a student" />
              <CreateStudentForm onCreated={() => setRefreshKey((k) => k + 1)} />
            </Card>
          )
        )}
      </div>
    </AppShell>
  );
}
