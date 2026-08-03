"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch, ApiError } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { Button } from "../../components/atoms/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { ReportCardList } from "../../components/organisms/report-card-list";

const ALL = "__all__";

interface StudentOption {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface TermOption {
  id: string;
  name: string;
}

export default function ReportCardsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [studentFilter, setStudentFilter] = useState(ALL);
  const [termFilter, setTermFilter] = useState(ALL);

  const [genStudentId, setGenStudentId] = useState("");
  const [genTermId, setGenTermId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiFetch<StudentOption[]>("/students", { auth: true }).then(setStudents).catch(() => setStudents([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, []);

  const isAdmin = user ? user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") : false;

  async function handleGenerate() {
    setGenError(null);
    setGenerating(true);
    try {
      await apiFetch("/term-report-cards/generate", {
        method: "POST",
        auth: true,
        body: { studentId: genStudentId, termId: genTermId },
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : "Failed to generate report card");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Report Cards" title="Report Cards" />

      {isAdmin && (
        <Card className="mb-4">
          <CardHeader title="Generate a full-term report card" sub="Mid-term reports are generated automatically by the worker" />
          {genError && <p className="mb-2 text-sm text-danger">{genError}</p>}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="gen-student">Student</Label>
              <Select value={genStudentId} onValueChange={setGenStudentId}>
                <SelectTrigger id="gen-student" className="mt-1">
                  <SelectValue placeholder="Select student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.user.firstName} {student.user.lastName} ({student.admissionNumber})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gen-term">Term</Label>
              <Select value={genTermId} onValueChange={setGenTermId}>
                <SelectTrigger id="gen-term" className="mt-1">
                  <SelectValue placeholder="Select term" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                disabled={generating || !genStudentId || !genTermId}
                onClick={handleGenerate}
                className="w-full"
              >
                {generating ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Report cards" />
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="filter-student">Student</Label>
            <Select value={studentFilter} onValueChange={setStudentFilter}>
              <SelectTrigger id="filter-student" className="mt-1">
                <SelectValue placeholder="All students" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All students</SelectItem>
                {students.map((student) => (
                  <SelectItem key={student.id} value={student.id}>
                    {student.user.firstName} {student.user.lastName} ({student.admissionNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="filter-term">Term</Label>
            <Select value={termFilter} onValueChange={setTermFilter}>
              <SelectTrigger id="filter-term" className="mt-1">
                <SelectValue placeholder="All terms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All terms</SelectItem>
                {terms.map((term) => (
                  <SelectItem key={term.id} value={term.id}>
                    {term.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ReportCardList
          studentId={studentFilter === ALL ? "" : studentFilter}
          termId={termFilter === ALL ? "" : termFilter}
          students={students}
          terms={terms}
          canManage={isAdmin}
          refreshKey={refreshKey}
        />
      </Card>
    </AppShell>
  );
}
