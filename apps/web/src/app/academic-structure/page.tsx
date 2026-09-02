"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/molecules/tabs";
import { AcademicSessionManager } from "../../components/organisms/academic-session-manager";
import { TermManager } from "../../components/organisms/term-manager";
import { ClassLevelManager } from "../../components/organisms/class-level-manager";
import { ClassArmManager } from "../../components/organisms/class-arm-manager";
import { DepartmentManager } from "../../components/organisms/department-manager";
import { SchoolEventManager } from "../../components/organisms/school-event-manager";

type TabKey = "sessions" | "terms" | "class-levels" | "arms" | "events";
const TAB_KEYS: TabKey[] = ["sessions", "terms", "class-levels", "arms", "events"];
const TAB_LABEL: Record<TabKey, string> = {
  sessions: "Academic Sessions",
  terms: "Terms",
  "class-levels": "Class Levels & Departments",
  arms: "Class Arms",
  events: "School Events",
};

export default function AcademicStructurePage() {
  return (
    <Suspense fallback={null}>
      <AcademicStructurePageInner />
    </Suspense>
  );
}

function AcademicStructurePageInner() {
  const { user, loading, logout } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "sessions";
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initialTab) ? initialTab : "sessions");

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  // Matches the backend CASL grant (ability.factory.ts): Principal/
  // Headteacher get `manage AcademicStructure` too, same near-Admin-parity
  // extension as Report Cards/Gradebook/Attendance.
  const canManage =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));

  if (!canManage) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Academics · Structure" title="Academic structure" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage academic structure.</p>
        </Card>
      </AppShell>
    );
  }

  function changeTab(next: TabKey) {
    setTab(next);
    router.replace(`/academic-structure?tab=${next}`);
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Structure" title="Academic structure" />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as TabKey)}>
        <TabsList>
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="sessions">
          <CollapsibleCard title="Academic sessions" sub="Exactly one is current at a time (PRD §3.2)">
            <AcademicSessionManager />
          </CollapsibleCard>
        </TabsContent>

        <TabsContent value="terms">
          <CollapsibleCard title="Terms" sub="One current term per session — required for compulsory subject auto-enrollment">
            <TermManager />
          </CollapsibleCard>
        </TabsContent>

        <TabsContent value="class-levels">
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
            <CollapsibleCard title="Class levels">
              <ClassLevelManager />
            </CollapsibleCard>
            <CollapsibleCard title="Departments" sub="SSS-only (PRD §3.2)">
              <DepartmentManager />
            </CollapsibleCard>
          </div>
        </TabsContent>

        <TabsContent value="arms">
          <CollapsibleCard title="Class arms">
            <ClassArmManager />
          </CollapsibleCard>
        </TabsContent>

        <TabsContent value="events">
          <CollapsibleCard title="School events" sub="Clubs Day, Inter-house Sports, excursions — shown to every user on the Calendar">
            <SchoolEventManager />
          </CollapsibleCard>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
