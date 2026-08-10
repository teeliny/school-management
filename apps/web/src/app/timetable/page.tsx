"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { Label } from "../../components/atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/molecules/select";
import { TimetableGrid } from "../../components/organisms/timetable-grid";
import { TimetableSlotForm } from "../../components/organisms/timetable-slot-form";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}

export default function TimetablePage() {
  const { user, loading, logout } = useCurrentUser();
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classArmId, setClassArmId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
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

  const isAdmin = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  // Matches the backend CASL grant: Principal/Headteacher get `manage
  // TimetableSlot` too, same as Registrar (ability.factory.ts).
  const canManage =
    isAdmin ||
    user.assignmentTypes.includes("REGISTRAR") ||
    ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
  const termsForSession = terms.filter((t) => !academicSessionId || t.academicSessionId === academicSessionId);

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Timetable" title="Class timetable" />

      <CollapsibleCard title="Select class, session, and term" className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="tt-class-arm">Class arm</Label>
            <Select value={classArmId} onValueChange={setClassArmId}>
              <SelectTrigger id="tt-class-arm" className="mt-1">
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classArms.map((arm) => (
                  <SelectItem key={arm.id} value={arm.id}>
                    {arm.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tt-session">Academic session</Label>
            <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
              <SelectTrigger id="tt-session" className="mt-1">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tt-term">Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger id="tt-term" className="mt-1">
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                {termsForSession.map((term) => (
                  <SelectItem key={term.id} value={term.id}>
                    {term.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleCard>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.6fr_1fr]">
        <CollapsibleCard title="Weekly timetable">
          <TimetableGrid
            classArmId={classArmId}
            academicSessionId={academicSessionId}
            termId={termId}
            refreshKey={refreshKey}
          />
        </CollapsibleCard>

        {canManage && (
          <CollapsibleCard title="Add a slot">
            <TimetableSlotForm
              classArmId={classArmId}
              academicSessionId={academicSessionId}
              termId={termId}
              onCreated={() => setRefreshKey((k) => k + 1)}
            />
          </CollapsibleCard>
        )}
      </div>
    </AppShell>
  );
}
