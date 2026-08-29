"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch, ApiError } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { Button } from "../../components/atoms/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { StudentCombobox } from "../../components/molecules/student-combobox";
import { ReportCardList } from "../../components/organisms/report-card-list";
import { ReportCardFilters, REPORT_CARD_FILTER_ALL as ALL } from "../../components/organisms/report-card-filters";
import { ParentReportCardSection } from "../../components/organisms/parent-report-card-section";
import { StaffReportCardSection } from "../../components/organisms/staff-report-card-section";

interface TermOption {
  id: string;
  name: string;
}
interface ClassArmOption {
  id: string;
  displayName: string;
}
interface ProgressSummary {
  totalStudents: number;
  generatedCount: number;
}
interface ClassReadinessStudent {
  studentId: string;
  studentName: string;
  ready: boolean;
  missing: string[];
}
interface ClassReadiness {
  totalStudents: number;
  students: ClassReadinessStudent[];
}
interface GenerateClassResult {
  generatedCount: number;
  skipped: { studentId: string; studentName: string; missing: string[] }[];
}

export default function ReportCardsPage() {
  return (
    <Suspense fallback={null}>
      <ReportCardsPageInner />
    </Suspense>
  );
}

function ReportCardsPageInner() {
  const { user, loading, logout } = useCurrentUser();
  const searchParams = useSearchParams();
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  // A student profile's "Report card" quick link arrives as
  // `?studentId=...` — pre-selects the filter so the list opens already
  // scoped to that one student, same term-auto-select ReportCardFilters
  // already does for "current term."
  const [studentFilter, setStudentFilter] = useState(searchParams.get("studentId") ?? ALL);
  const [termFilter, setTermFilter] = useState(ALL);
  const [classArmFilter, setClassArmFilter] = useState(ALL);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [classReadiness, setClassReadiness] = useState<ClassReadiness | null>(null);
  const [generatingClass, setGeneratingClass] = useState(false);
  const [classGenError, setClassGenError] = useState<string | null>(null);
  const [classGenResult, setClassGenResult] = useState<GenerateClassResult | null>(null);
  const [showMissingDetails, setShowMissingDetails] = useState(false);

  const [genClassArmId, setGenClassArmId] = useState("");
  const [genStudentId, setGenStudentId] = useState("");
  const [genTermId, setGenTermId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Matches the backend CASL grant (ability.factory.ts): SUPER_ADMIN, ADMIN,
  // and a STAFF user with an active PRINCIPAL/HEADTEACHER assignment can all
  // generate/regenerate/publish report cards — deleting stays Super-Admin-only
  // (term-report-card.ts's `remove` is a hardcoded role check, not CASL).
  const canManageReports = user
    ? user.roles.includes("SUPER_ADMIN") ||
      user.roles.includes("ADMIN") ||
      user.assignmentTypes.includes("PRINCIPAL") ||
      user.assignmentTypes.includes("HEADTEACHER")
    : false;
  const isSuperAdmin = user ? user.roles.includes("SUPER_ADMIN") : false;
  // The "browse everything, pick any class" card below is reserved for this
  // admin tier — a regular teacher gets StaffReportCardSection instead
  // (homeroom-only, no school-wide picker), and a parent gets
  // ParentReportCardSection (their own wards only). Broader than
  // canManageReports (REGISTRAR can browse but not generate/publish).
  const isAdminTier = user
    ? user.roles.includes("SUPER_ADMIN") ||
      user.roles.includes("ADMIN") ||
      user.assignmentTypes.includes("REGISTRAR") ||
      user.assignmentTypes.includes("PRINCIPAL") ||
      user.assignmentTypes.includes("HEADTEACHER")
    : false;

  useEffect(() => {
    if (!user) return;
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    // A school-wide student roster can run into the thousands, so it's never
    // fetched wholesale — StudentCombobox (both here and in the Generate
    // panel below) fetches a server-searched, paginated page per chosen
    // class arm instead. Only the admin-tier browse card below needs the
    // full class-arm list; a regular teacher's/parent's own sections fetch
    // their own narrower scope independently.
    if (isAdminTier) {
      apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    }
  }, [user, isAdminTier]);

  // A different class arm invalidates whichever student was picked for the
  // previous one.
  useEffect(() => {
    setGenStudentId("");
  }, [genClassArmId]);

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

  // Driven by the Generate panel's own Class arm/Term (genClassArmId/
  // genTermId), not the Report cards list's filters below — whole-class
  // generation is an action taken from the Generate panel, independent of
  // whatever the list happens to be filtered to.
  useEffect(() => {
    setShowMissingDetails(false);
    if (!canManageReports || !genClassArmId || !genTermId) {
      setClassReadiness(null);
      return;
    }
    setClassGenResult(null);
    apiFetch<ClassReadiness>(
      `/term-report-cards/class-readiness?classArmId=${genClassArmId}&termId=${genTermId}`,
      { auth: true },
    )
      .then(setClassReadiness)
      .catch(() => setClassReadiness(null));
  }, [canManageReports, genClassArmId, genTermId, refreshKey]);

  async function handleGenerateClass() {
    if (!genClassArmId || !genTermId) return;
    setClassGenError(null);
    setClassGenResult(null);
    setGeneratingClass(true);
    try {
      const result = await apiFetch<GenerateClassResult>("/term-report-cards/generate-class", {
        method: "POST",
        auth: true,
        body: { classArmId: genClassArmId, termId: genTermId },
      });
      setClassGenResult(result);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setClassGenError(err instanceof ApiError ? err.message : "Failed to generate report cards for class");
    } finally {
      setGeneratingClass(false);
    }
  }

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
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Report Cards" title="Report Cards" />

      {canManageReports && (
        <Card className="mb-4">
          <CardHeader title="Generate a full-term report card" sub="Mid-term reports are generated automatically by the worker" />
          {genError && <p className="mb-2 text-sm text-danger">{genError}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="gen-class-arm">Class arm</Label>
              <Select value={genClassArmId} onValueChange={setGenClassArmId}>
                <SelectTrigger id="gen-class-arm" className="mt-1">
                  <SelectValue placeholder="Select class arm" />
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
              <Label htmlFor="gen-student">Student</Label>
              <StudentCombobox
                id="gen-student"
                classArmId={genClassArmId}
                value={genStudentId}
                onValueChange={(id) => setGenStudentId(id)}
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

          {classReadiness && classReadiness.totalStudents > 0 && (
            <div className="mt-4 rounded-card border border-border bg-card-inset p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12.5px] text-muted">
                  Full-term readiness: {classReadiness.students.filter((s) => s.ready).length}/
                  {classReadiness.totalStudents} students ready to generate
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {classReadiness.students.some((s) => !s.ready) && (
                    <button
                      type="button"
                      onClick={() => setShowMissingDetails((v) => !v)}
                      className="text-[11px] text-muted underline"
                    >
                      {showMissingDetails ? "Hide details" : "View details"}
                    </button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={generatingClass || classReadiness.students.every((s) => !s.ready)}
                    onClick={handleGenerateClass}
                  >
                    {generatingClass ? "Generating…" : "Generate for whole class"}
                  </Button>
                </div>
              </div>
              {classGenError && <p className="mt-2 text-sm text-danger">{classGenError}</p>}
              {classGenResult && (
                <p className="mt-2 text-[12.5px] text-muted">
                  Generated {classGenResult.generatedCount} report card(s)
                  {classGenResult.skipped.length > 0
                    ? `, skipped ${classGenResult.skipped.length} not-ready student(s)`
                    : ""}
                  .
                </p>
              )}
              {showMissingDetails && (
                <div className="mt-2 max-h-[250px] overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="py-1.5 px-2 text-[10px] font-medium uppercase tracking-wide">Student</th>
                        <th className="py-1.5 px-2 text-[10px] font-medium uppercase tracking-wide">Missing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classReadiness.students
                        .filter((s) => !s.ready)
                        .map((s) => (
                          <tr key={s.studentId} className="border-b border-border/60 last:border-none">
                            <td className="py-1.5 px-2 align-top font-medium">{s.studentName}</td>
                            <td className="py-1.5 px-2 align-top text-muted">
                              <ul className="list-disc space-y-0.5 pl-4">
                                {s.missing.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {isAdminTier && (
        <Card>
          <CardHeader title="Report cards" />
          <ReportCardFilters
            classArms={classArms}
            classArmFilter={classArmFilter}
            onClassArmFilterChange={setClassArmFilter}
            studentFilter={studentFilter}
            onStudentFilterChange={setStudentFilter}
            termFilter={termFilter}
            onTermFilterChange={setTermFilter}
          />

          {progress && (
            <p className="mb-4 text-[12.5px] text-muted">
              Reports generated: {progress.generatedCount}/{progress.totalStudents} students
            </p>
          )}

          <ReportCardList
            studentId={studentFilter === ALL ? "" : studentFilter}
            termId={termFilter === ALL ? "" : termFilter}
            classArmId={classArmFilter === ALL ? "" : classArmFilter}
            terms={terms}
            canManage={canManageReports}
            canDelete={isSuperAdmin}
            refreshKey={refreshKey}
          />
        </Card>
      )}

      {user.parentProfileId && <ParentReportCardSection />}
      {user.staffProfileId && !isAdminTier && <StaffReportCardSection />}
    </AppShell>
  );
}
