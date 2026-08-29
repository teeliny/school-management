"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { SchoolProfileManager } from "../../components/organisms/school-profile-manager";

export default function SchoolProfilePage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  // Super-Admin only — deliberately narrower than the AcademicStructure
  // grant (which Admin/Principal/Headteacher also get). Matches the
  // backend CASL check (ability.factory.ts's "manage SchoolProfile", only
  // reachable via SUPER_ADMIN's "manage all").
  const canManage = user.roles.includes("SUPER_ADMIN");

  if (!canManage) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Settings" title="School profile" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage the school profile.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Settings" title="School profile" />
      <p className="mb-4 text-[12.5px] text-muted">
        Name, contact info, and logo shown on report cards and other generated documents.
      </p>
      <Card>
        <SchoolProfileManager />
      </Card>
    </AppShell>
  );
}
