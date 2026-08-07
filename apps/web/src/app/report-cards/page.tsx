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
import { SearchableSelect } from "../../components/molecules/searchable-select";
import { ReportCardList } from "../../components/organisms/report-card-list";

const ALL = "__all__";

interface StudentOption {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface TermOption {
  id: string;
  name: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
}
interface ClassArmOption {
  id: string;
  classLevelId: string;
  displayName: string;
}
interface ProgressSummary {
  totalStudents: number;
  generatedCount: number;
}

function studentOptionLabel(student: StudentOption) {
  return `${student.user.firstName} ${student.user.lastName} (${student.admissionNumber})`;
}

export default function ReportCardsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [studentFilter, setStudentFilter] = useState(ALL);
  const [termFilter, setTermFilter] = useState(ALL);
  const [classArmFilter, setClassArmFilter] = useState(ALL);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);

  const [genClassLevelId, setGenClassLevelId] = useState("");
  const [genStudentId, setGenStudentId] = useState("");
  const [genTermId, setGenTermId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiFetch<StudentOption[]>("/students", { auth: true }).then(setStudents).catch(() => setStudents([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
  }, []);

  const studentOptions = students.map((student) => ({ value: student.id, label: studentOptionLabel(student) }));

  // Narrows the Generate section's student picker to the chosen class level
  // (via its arms' currentClassId), same "level → student" narrowing shape
  // as the broadsheet's class level filter.
  const genArmIdsForLevel = classArms.filter((arm) => arm.classLevelId === genClassLevelId).map((arm) => arm.id);
  const genStudentOptions = students
    .filter((student) => student.currentClassId && genArmIdsForLevel.includes(student.currentClassId))
    .map((student) => ({ value: student.id, label: studentOptionLabel(student) }));

  // A different class level invalidates whichever student was picked for
  // the previous one.
  useEffect(() => {
    setGenStudentId("");
  }, [genClassLevelId]);

  useEffect(() => {
    if (classArmFilter === ALL || termFilter === ALL) {
      setProgress(null);
      return;
    }
    apiFetch<ProgressSummary>(
      `/term-report-cards/progress?classArmId=${classArmFilter}&termId=${termFilter}`,
      { auth: true },
    )
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [classArmFilter, termFilter, refreshKey]);

  const isAdmin = user ? user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") : false;
  const isSuperAdmin = user ? user.roles.includes("SUPER_ADMIN") : false;

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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="gen-class-level">Class level</Label>
              <Select value={genClassLevelId} onValueChange={setGenClassLevelId}>
                <SelectTrigger id="gen-class-level" className="mt-1">
                  <SelectValue placeholder="Select class level" />
                </SelectTrigger>
                <SelectContent>
                  {classLevels.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gen-student">Student</Label>
              <SearchableSelect
                id="gen-student"
                value={genStudentId}
                onValueChange={setGenStudentId}
                options={genStudentOptions}
                placeholder={genClassLevelId ? "Select student" : "Select a class level first"}
                searchPlaceholder="Search by name or admission number…"
                className="mt-1"
              />
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
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="filter-class-arm">Class arm</Label>
            <Select value={classArmFilter} onValueChange={setClassArmFilter}>
              <SelectTrigger id="filter-class-arm" className="mt-1">
                <SelectValue placeholder="All class arms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All class arms</SelectItem>
                {classArms.map((arm) => (
                  <SelectItem key={arm.id} value={arm.id}>
                    {arm.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="filter-student">Student</Label>
            <SearchableSelect
              id="filter-student"
              value={studentFilter}
              onValueChange={setStudentFilter}
              options={[{ value: ALL, label: "All students" }, ...studentOptions]}
              placeholder="All students"
              searchPlaceholder="Search by name or admission number…"
              className="mt-1"
            />
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

        {progress && (
          <p className="mb-4 text-[12.5px] text-muted">
            Reports generated: {progress.generatedCount}/{progress.totalStudents} students
          </p>
        )}

        <ReportCardList
          studentId={studentFilter === ALL ? "" : studentFilter}
          termId={termFilter === ALL ? "" : termFilter}
          classArmId={classArmFilter === ALL ? "" : classArmFilter}
          students={students}
          terms={terms}
          canManage={isAdmin}
          canDelete={isSuperAdmin}
          refreshKey={refreshKey}
        />
      </Card>
    </AppShell>
  );
}
