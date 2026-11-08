"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { AssessmentProgressView } from "../../components/organisms/assessment-progress-view";

// Same audience as GET /dashboard/assessment-progress's own gate
// (DashboardService.resolveAssessmentProgressCategories).
const SCOPED_TITLES = ["REGISTRAR", "PRINCIPAL", "VICE_PRINCIPAL", "HEADTEACHER"];

export default function AssessmentProgressPage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) return <PageLoadingSkeleton />;
  if (!user) return null;

  const canView =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    SCOPED_TITLES.some((t) => user.assignmentTypes.includes(t));

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Progress" title="Assessment progress" />
      {canView ? (
        <AssessmentProgressView user={user} />
      ) : (
        <Card>
          <p className="text-sm text-muted">
            Only the Super-Admin, Admin, Registrar, Principal, Vice Principal or Headteacher can view assessment progress.
          </p>
        </Card>
      )}
    </AppShell>
  );
}
