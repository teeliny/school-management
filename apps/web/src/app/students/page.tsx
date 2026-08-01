"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { CreateStudentForm } from "../../components/organisms/create-student-form";
import { PeopleList } from "../../components/organisms/people-list";

export default function StudentsPage() {
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

  const canCreate = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Students" title="Students" />

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Students" sub="Scoped to what your role can see" />
          <PeopleList refreshKey={refreshKey} />
        </Card>

        {canCreate && (
          <Card>
            <CardHeader title="Enroll a student" />
            <CreateStudentForm onCreated={() => setRefreshKey((k) => k + 1)} />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
