"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch, ApiError } from "../../lib/api";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { cn } from "../../lib/cn";

interface TermOption {
  id: string;
  name: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
}
interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevelId: string;
}
interface BroadsheetSubjectCell {
  subjectId: string;
  totalScore: number | null;
  grade: string | null;
  position: number | null;
}
interface BroadsheetRow {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  classArmId: string;
  classArmName: string;
  subjects: BroadsheetSubjectCell[];
  overallAverage: number | null;
  overallGrade: string | null;
  overallPosition: number | null;
}
interface BroadsheetResponse {
  mode: "TERM" | "SESSION";
  termId: string | null;
  academicSessionId: string;
  periodLabel: string;
  classLevelId: string;
  classLevelName: string;
  scope: "CLASS_LEVEL" | "CLASS_ARM";
  classArmId: string | null;
  subjectColumns: { id: string; name: string }[];
  rows: BroadsheetRow[];
  total: number;
}
type BroadsheetMeta = Omit<BroadsheetResponse, "rows" | "total">;

// Sentinel for the "class-level default" (Select can't carry an empty-string
// value) — narrowing to a single arm is the fallback, opted into explicitly.
const ALL_ARMS = "__all__";
const PAGE_SIZE = 25;

type SortKey = "average" | "position" | string;
type SortDir = "asc" | "desc";

export default function BroadsheetPage() {
  const { user, loading, logout } = useCurrentUser();
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [academicSessions, setAcademicSessions] = useState<AcademicSessionOption[]>([]);
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);

  const [viewMode, setViewMode] = useState<"TERM" | "SESSION">("TERM");
  const [termId, setTermId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [classLevelId, setClassLevelId] = useState("");
  const [classArmId, setClassArmId] = useState(ALL_ARMS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const [meta, setMeta] = useState<BroadsheetMeta | null>(null);
  const [rows, setRows] = useState<BroadsheetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an in-flight request from a superseded filter/sort/page
  // resolving after a newer one and clobbering the list with stale data.
  const requestId = useRef(0);

  const canView = user
    ? user.roles.includes("SUPER_ADMIN") || ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t))
    : false;

  useEffect(() => {
    if (!canView) return;
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then(setAcademicSessions)
      .catch(() => setAcademicSessions([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
  }, [canView]);

  const armsForLevel = useMemo(
    () => classArms.filter((a) => a.classLevelId === classLevelId),
    [classArms, classLevelId],
  );

  // A different class level invalidates whichever arm was picked for the
  // previous one.
  useEffect(() => {
    setClassArmId(ALL_ARMS);
  }, [classLevelId]);

  const loadPage = useCallback(
    (skip: number) => {
      if (!classLevelId) return;
      if (viewMode === "TERM" && !termId) return;
      if (viewMode === "SESSION" && !academicSessionId) return;

      const thisRequest = ++requestId.current;
      if (skip === 0) setPageLoading(true);
      else setLoadingMore(true);
      setError(null);

      const params = new URLSearchParams();
      if (viewMode === "TERM") params.set("termId", termId);
      else params.set("academicSessionId", academicSessionId);
      if (classArmId === ALL_ARMS) params.set("classLevelId", classLevelId);
      else params.set("classArmId", classArmId);
      if (sort) {
        params.set("sortBy", sort.key);
        params.set("sortDir", sort.dir);
      }
      params.set("skip", String(skip));
      params.set("take", String(PAGE_SIZE));

      apiFetch<BroadsheetResponse>(`/broadsheet?${params.toString()}`, { auth: true })
        .then((res) => {
          if (thisRequest !== requestId.current) return;
          const { rows: pageRows, total: resTotal, ...restMeta } = res;
          setMeta(restMeta);
          setRows((prev) => (skip === 0 ? pageRows : [...prev, ...pageRows]));
          setTotal(resTotal);
        })
        .catch((err) => {
          if (thisRequest !== requestId.current) return;
          setError(err instanceof ApiError ? err.message : "Failed to load broadsheet");
        })
        .finally(() => {
          if (thisRequest === requestId.current) {
            setPageLoading(false);
            setLoadingMore(false);
          }
        });
    },
    [viewMode, termId, academicSessionId, classLevelId, classArmId, sort],
  );

  // Any filter/sort change starts over from the first page.
  useEffect(() => {
    setRows([]);
    setTotal(0);
    setMeta(null);
    loadPage(0);
  }, [loadPage]);

  const loadMore = useCallback(() => loadPage(rows.length), [loadPage, rows.length]);
  const hasMore = rows.length < total;
  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore, loading: loadingMore, root: null });

  function toggleSort(key: SortKey, defaultDir: SortDir) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir }));
  }

  function SortIndicator({ sortKey }: { sortKey: SortKey }) {
    if (sort?.key !== sortKey) return null;
    return <span className="ml-1">{sort.dir === "asc" ? "▲" : "▼"}</span>;
  }

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  if (!canView) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Assessment · Broadsheet" title="Broadsheet" />
        <Card>
          <p className="text-sm text-muted">Only the Super-Admin or a Principal/Headteacher can view the broadsheet.</p>
        </Card>
      </AppShell>
    );
  }

  const scopedArmName = meta?.classArmId ? classArms.find((a) => a.id === meta.classArmId)?.displayName : undefined;
  const heading = meta ? (meta.scope === "CLASS_ARM" ? scopedArmName ?? meta.classLevelName : meta.classLevelName) : "Broadsheet";
  const thBase = "py-2 pr-4 text-[10px] font-medium uppercase tracking-wide";
  const sortableTh = "cursor-pointer select-none hover:text-foreground";

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Broadsheet" title="Broadsheet" />

      <Card className="mb-4">
        <CardHeader
          title="Select period and class"
          sub="Defaults to the whole class level (every arm combined) — pick a specific arm to narrow it down"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="bs-view">View</Label>
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as "TERM" | "SESSION")}>
              <SelectTrigger id="bs-view" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TERM">By term</SelectItem>
                <SelectItem value="SESSION">Overall (session average)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {viewMode === "TERM" ? (
            <div>
              <Label htmlFor="bs-term">Term</Label>
              <Select value={termId} onValueChange={setTermId}>
                <SelectTrigger id="bs-term" className="mt-1">
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
          ) : (
            <div>
              <Label htmlFor="bs-session">Academic session</Label>
              <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
                <SelectTrigger id="bs-session" className="mt-1">
                  <SelectValue placeholder="Select session" />
                </SelectTrigger>
                <SelectContent>
                  {academicSessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="bs-level">Class level</Label>
            <Select value={classLevelId} onValueChange={setClassLevelId}>
              <SelectTrigger id="bs-level" className="mt-1">
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
            <Label htmlFor="bs-arm">Class arm (optional)</Label>
            <Select value={classArmId} onValueChange={setClassArmId}>
              <SelectTrigger id="bs-arm" className="mt-1">
                <SelectValue placeholder={classLevelId ? "All arms" : "Select a class level first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ARMS}>All arms</SelectItem>
                {armsForLevel.map((arm) => (
                  <SelectItem key={arm.id} value={arm.id}>
                    {arm.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={heading} sub={meta ? `${meta.periodLabel} — ${total} student(s)` : undefined} />
        {error && <p className="text-sm text-danger">{error}</p>}
        {!error && pageLoading && rows.length === 0 && <p className="text-sm text-muted">Loading…</p>}
        {!error && !pageLoading && !meta && <p className="text-sm text-muted">Select a period and class level above.</p>}
        {!error && !pageLoading && meta && rows.length === 0 && (
          <p className="text-sm text-muted">No students found for this scope.</p>
        )}
        {!error && meta && rows.length > 0 && (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className={cn(thBase, "sticky left-0 z-10 bg-card")}>Student</th>
                  {meta.scope === "CLASS_LEVEL" && <th className={thBase}>Arm</th>}
                  {meta.subjectColumns.map((subject) => (
                    <th
                      key={subject.id}
                      className={cn(thBase, sortableTh)}
                      onClick={() => toggleSort(subject.id, "desc")}
                    >
                      {subject.name}
                      <SortIndicator sortKey={subject.id} />
                    </th>
                  ))}
                  <th className={cn(thBase, sortableTh)} onClick={() => toggleSort("average", "desc")}>
                    Average
                    <SortIndicator sortKey="average" />
                  </th>
                  <th className={cn(thBase, sortableTh)} onClick={() => toggleSort("position", "asc")}>
                    Position
                    <SortIndicator sortKey="position" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.studentId} className="border-b border-border/60 last:border-none">
                    <td className="sticky left-0 z-10 bg-card py-2.5 pr-4">
                      <div className="font-medium">{row.studentName}</div>
                      <div className="font-mono text-[11px] text-muted">{row.admissionNumber}</div>
                    </td>
                    {meta.scope === "CLASS_LEVEL" && <td className="py-2.5 pr-4 text-muted">{row.classArmName}</td>}
                    {row.subjects.map((cell) => (
                      <td key={cell.subjectId} className="py-2.5 pr-4 font-mono">
                        {cell.totalScore === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            {cell.totalScore.toFixed(2)}
                            {cell.grade && <span className="ml-1 text-muted">{cell.grade}</span>}
                          </>
                        )}
                      </td>
                    ))}
                    <td className="py-2.5 pr-4 font-mono font-medium">
                      {row.overallAverage === null ? <span className="text-muted">—</span> : row.overallAverage.toFixed(2)}
                    </td>
                    <td className="py-2.5 font-mono">{row.overallPosition ?? <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div ref={sentinelRef} />
            {loadingMore && <p className="py-2 text-center text-[11.5px] text-muted">Loading more…</p>}
          </div>
        )}
        {!error && meta && rows.length > 0 && (
          <p className="mt-2 text-[11px] text-muted">
            Showing {rows.length} of {total}
          </p>
        )}
      </Card>
    </AppShell>
  );
}
