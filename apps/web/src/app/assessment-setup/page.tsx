"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { AssessmentComponentManager } from "../../components/organisms/assessment-component-manager";
import { GradeScaleManager } from "../../components/organisms/grade-scale-manager";
import { SkillAssessmentItemManager } from "../../components/organisms/skill-assessment-item-manager";
import { ReportWindowManager } from "../../components/organisms/report-window-manager";

interface TermOption {
  id: string;
  name: string;
}

export default function AssessmentSetupPage() {
  const { user, loading, logout } = useCurrentUser();
  const [terms, setTerms] = useState<TermOption[]>([]);

  useEffect(() => {
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  // Matches the backend CASL grant: Principal/Headteacher get `manage
  // AssessmentComponent/SkillAssessmentItem/ReportWindow` too (also covers
  // Grade Scale, which reuses the AssessmentComponent grant server-side).
  const canManage =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));

  if (!canManage) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Assessment · Setup" title="Assessment setup" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage assessment setup.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Setup" title="Assessment setup" />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Assessment components"
            sub="Must sum to 100 per term + class group before any component can open (PRD §3.6)"
          />
          <AssessmentComponentManager terms={terms} />
        </Card>

        <Card>
          <CardHeader title="Grade scale" sub="Grade + remark are configured together — reports show whichever remark matches a subject's score" />
          <GradeScaleManager />
        </Card>

        <Card>
          <CardHeader title="Skill assessment items" sub="Psychomotor + Affective/Cognitive lists, once per academic session (PRD FR4.5)" />
          <SkillAssessmentItemManager />
        </Card>

        <Card>
          <CardHeader title="Report windows" sub="Gates skill ratings and the class-teacher comment (PRD §3.6)" />
          <ReportWindowManager terms={terms} />
        </Card>
      </div>
    </AppShell>
  );
}
