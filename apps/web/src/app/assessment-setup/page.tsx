"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/molecules/tabs";
import { AssessmentComponentManager } from "../../components/organisms/assessment-component-manager";
import { GradeScaleManager } from "../../components/organisms/grade-scale-manager";
import { SkillAssessmentItemManager } from "../../components/organisms/skill-assessment-item-manager";
import { ReportWindowManager } from "../../components/organisms/report-window-manager";

interface TermOption {
  id: string;
  name: string;
}

type TabKey = "components" | "grade-scale" | "skills" | "windows";
const TAB_KEYS: TabKey[] = ["components", "grade-scale", "skills", "windows"];
const TAB_LABEL: Record<TabKey, string> = {
  components: "Assessment Components",
  "grade-scale": "Grade Scale",
  skills: "Skill Assessment Items",
  windows: "Report Windows",
};

export default function AssessmentSetupPage() {
  return (
    <Suspense fallback={null}>
      <AssessmentSetupPageInner />
    </Suspense>
  );
}

function AssessmentSetupPageInner() {
  const { user, loading, logout } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [terms, setTerms] = useState<TermOption[]>([]);

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "components";
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initialTab) ? initialTab : "components");

  useEffect(() => {
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, []);

  if (loading) {
    return <PageLoadingSkeleton />;
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

  function changeTab(next: TabKey) {
    setTab(next);
    router.replace(`/assessment-setup?tab=${next}`);
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Setup" title="Assessment setup" />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as TabKey)}>
        <TabsList>
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="components">
          <Card>
            <CardHeader
              title="Assessment components"
              sub="Must sum to 100 per term + class group before any component can open (PRD §3.6)"
            />
            <AssessmentComponentManager terms={terms} />
          </Card>
        </TabsContent>

        <TabsContent value="grade-scale">
          <Card>
            <CardHeader title="Grade scale" sub="Grade + remark are configured together — reports show whichever remark matches a subject's score" />
            <GradeScaleManager />
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardHeader title="Skill assessment items" sub="Psychomotor + Affective/Cognitive lists, once per academic session (PRD FR4.5)" />
            <SkillAssessmentItemManager />
          </Card>
        </TabsContent>

        <TabsContent value="windows">
          <Card>
            <CardHeader title="Report windows" sub="Gates skill ratings and the class-teacher comment (PRD §3.6)" />
            <ReportWindowManager terms={terms} />
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
