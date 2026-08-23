"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/molecules/tabs";
import { AdmissionInquiryList } from "../../components/organisms/admission-inquiry-list";
import { CareerContactInquiryList } from "../../components/organisms/career-contact-inquiry-list";

export default function InquiriesPage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const isAdmin = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  // Matches AdmissionInquiryService.notifyStaff / the CASL "read" grant in
  // ability.factory.ts — Registrar/Principal/Headteacher see admission
  // inquiries only, never Careers & Contact.
  const canSeeAdmissions =
    isAdmin || ["REGISTRAR", "PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));

  if (!canSeeAdmissions) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Connect · Inquiries" title="Inquiries" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to view inquiries.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Connect · Inquiries" title="Inquiries" />

      <Card>
        <Tabs defaultValue="admissions">
          <TabsList>
            <TabsTrigger value="admissions">Admissions</TabsTrigger>
            {isAdmin && <TabsTrigger value="careers">Careers &amp; Contact</TabsTrigger>}
          </TabsList>
          <TabsContent value="admissions">
            <AdmissionInquiryList canManage={isAdmin} />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="careers">
              <CareerContactInquiryList />
            </TabsContent>
          )}
        </Tabs>
      </Card>
    </AppShell>
  );
}
