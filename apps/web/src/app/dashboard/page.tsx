"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "../../lib/use-current-user";
import { useParentChildren } from "../../lib/use-parent-children";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { MySchedule } from "../../components/organisms/my-schedule";
import { SuperAdminDashboard } from "../../components/organisms/super-admin-dashboard";
import { AdminDashboard } from "../../components/organisms/admin-dashboard";
import { TeachingStaffDashboard } from "../../components/organisms/teaching-staff-dashboard";
import { ClassTeacherAdditions } from "../../components/organisms/class-teacher-additions";
import { PrincipalHeadteacherAdditions } from "../../components/organisms/principal-headteacher-additions";
import { RegistrarAdditions } from "../../components/organisms/registrar-additions";
import { BursarDashboard } from "../../components/organisms/bursar-dashboard";
import { ParentDashboard } from "../../components/organisms/parent-dashboard";
import { StudentDashboard } from "../../components/organisms/student-dashboard";

export default function DashboardPage() {
  const { user, loading, logout } = useCurrentUser();
  // Lifted up here (rather than fetched independently by ParentDashboard and
  // MySchedule) so both sections agree on which one child a multi-ward
  // parent is currently viewing.
  const children = useParentChildren(user?.parentProfileId ?? null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const hasAutoSelected = useRef(false);

  // Same "prefer the active ward" default report-card-filters.tsx's
  // auto-select already uses, so a parent with one inactive (e.g.
  // graduated/withdrawn) and one active child lands on the relevant one.
  useEffect(() => {
    const firstChild = children?.[0];
    if (hasAutoSelected.current || !firstChild) return;
    hasAutoSelected.current = true;
    setSelectedChildId((children?.find((c) => c.status === "ACTIVE") ?? firstChild).id);
  }, [children]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canManageStaff = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow={user.roles.join(" · ")} title={`Good to see you, ${user.firstName}.`} />

      <Card>
        <CardHeader title="Your account" sub={user.email} />
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/students" className="font-medium underline hover:no-underline">
            Students
          </Link>
          {canManageStaff && (
            <>
              <Link href="/staff" className="font-medium underline hover:no-underline">
                Staff assignments
              </Link>
              <Link href="/invitations" className="font-medium underline hover:no-underline">
                Invitations
              </Link>
            </>
          )}
        </nav>
      </Card>

      <SuperAdminDashboard user={user} />
      <AdminDashboard user={user} />
      <TeachingStaffDashboard user={user} />
      <ClassTeacherAdditions user={user} />
      <PrincipalHeadteacherAdditions user={user} />
      <RegistrarAdditions user={user} />
      <BursarDashboard user={user} />
      <ParentDashboard user={user} children={children} selectedChildId={selectedChildId} onSelectChild={setSelectedChildId} />
      <StudentDashboard user={user} />

      <MySchedule user={user} selectedChild={children?.find((c) => c.id === selectedChildId) ?? children?.[0] ?? null} />
    </AppShell>
  );
}
