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

  // Mirrors fees/page.tsx's own gate: Bursar/Super-Admin (school-wide), or a
  // Parent (their own wards only, per StudentService.findOneForUser's
  // scoping — she could only ever have reached this profile at all if this
  // is her own ward, same reasoning as StudentProfile's own doc comment).
  const canViewFees = user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("BURSAR") || user.roles.includes("PARENT");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Students" title="Student profile" />
      <StudentProfile studentId={id} canUploadPhoto={canUploadPhoto} canViewFees={canViewFees} />
    </AppShell>
  );
}
