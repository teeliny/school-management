"use client";

import { useParams } from "next/navigation";
import { useCurrentUser } from "../../../lib/use-current-user";
import { AppShell } from "../../../components/templates/app-shell";
import { Letterhead } from "../../../components/molecules/letterhead";
import { StudentProfile } from "../../../components/organisms/student-profile";

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canUploadPhoto =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    user.assignmentTypes.includes("CLASS_TEACHER");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Students" title="Student profile" />
      <StudentProfile studentId={id} canUploadPhoto={canUploadPhoto} />
    </AppShell>
  );
}
