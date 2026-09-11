"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import type { ClassLevelCategory, ClassLevelCategoryGroup } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";
import { SkeletonTable } from "../molecules/skeleton-table";
import { EmptyState } from "../molecules/empty-state";

interface TermOption {
  id: string;
  name: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
  category: ClassLevelCategory;
}
interface OutstandingBalanceRow {
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  classArmName: string | null;
  totalOutstanding: number;
  isDebtExcused: boolean;
  debtExcusedReason: string | null;
}
interface OutstandingBalancesPage {
  data: OutstandingBalanceRow[];
  total: number;
}

const ALL_TERMS = "__all_terms__";
const ALL_CLASS_LEVELS = "__all_class_levels__";
const ALL_SECTIONS = "__all_sections__";
const SECTION_LABEL: Record<ClassLevelCategoryGroup, string> = {
  JSS_SSS: "Secondary",
  CRECHE_NURSERY_PRIMARY: "Primary",
};
type ExcusedFilter = "ALL" | "EXCUSED" | "NOT_EXCUSED";
const EXCUSED_LABEL: Record<ExcusedFilter, string> = {
  ALL: "All students",
  EXCUSED: "Excused",
  NOT_EXCUSED: "Not excused",
};
const PAGE_SIZE = 25;

/**
 * One row per student with an overdue balance (school-wide for Super-Admin/
 * Bursar/Admin; scoped to their own section for Principal/VP/Headteacher —
 * enforced server-side by OutstandingBalanceService). Search and every
 * filter here are server-side query params, backend-paginated and appended
 * on scroll (useInfiniteScroll) rather than a client-side pass over an
 * already-fetched list.
 */
export function OutstandingBalancesList({
  canExcuse,
  canFilterBySection,
  onTotalChange,
}: {
  canExcuse: boolean;
  // The section (Primary/Secondary) filter is redundant for Principal/VP/
  // Headteacher (already hard-scoped to their own section server-side) and,
  // by product decision, hidden from Admin too — only Super-Admin/Bursar get
  // it, matching `canManageFees` in fees/page.tsx.
  canFilterBySection: boolean;
  onTotalChange?: (total: number) => void;
}) {
  const [rows, setRows] = useState<OutstandingBalanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [termId, setTermId] = useState(ALL_TERMS);
  const [classLevelId, setClassLevelId] = useState(ALL_CLASS_LEVELS);
  const [section, setSection] = useState(ALL_SECTIONS);
  const [excusedFilter, setExcusedFilter] = useState<ExcusedFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [excusingId, setExcusingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [unExcusingId, setUnExcusingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Guards against an in-flight request from a superseded filter set
  // resolving after a newer one and clobbering the list with stale data.
  const requestId = useRef(0);

  useEffect(() => {
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
  }, []);

  const loadPage = useCallback(
    (skip: number) => {
      const thisRequest = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
      if (termId !== ALL_TERMS) params.set("termId", termId);
      if (classLevelId !== ALL_CLASS_LEVELS) params.set("classLevelId", classLevelId);
      if (canFilterBySection && section !== ALL_SECTIONS) params.set("classLevelCategoryGroup", section);
      if (excusedFilter !== "ALL") params.set("isExcused", String(excusedFilter === "EXCUSED"));
      if (search) params.set("search", search);
      apiFetch<OutstandingBalancesPage>(`/outstanding-balances?${params.toString()}`, { auth: true })
        .then((res) => {
          if (thisRequest !== requestId.current) return;
          setRows((prev) => (skip === 0 ? res.data : [...prev, ...res.data]));
          setTotal(res.total);
        })
        .catch((err) => {
          if (thisRequest !== requestId.current) return;
          setError(err instanceof ApiError ? err.message : "Failed to load outstanding balances");
        })
        .finally(() => {
          if (thisRequest === requestId.current) setLoading(false);
        });
    },
    [termId, classLevelId, canFilterBySection, section, excusedFilter, search],
  );

  // `loadPage`'s own deps mirror every filter here, so its identity already
  // changes exactly when a reset-to-page-0 is needed.
  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  const hasMore = rows.length < total;
  const sentinelRef = useInfiniteScroll({ onLoadMore: () => loadPage(rows.length), hasMore, loading });

  async function confirmExcuse() {
    if (!excusingId) return;
    setSaving(true);
    try {
      await apiFetch(`/outstanding-balances/${excusingId}/excuse`, {
        method: "PATCH",
        auth: true,
        body: { isExcused: true, reason: reason || undefined },
      });
      setExcusingId(null);
      setReason("");
      loadPage(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to mark student as excused");
    } finally {
      setSaving(false);
    }
  }

  async function confirmUnExcuse() {
    if (!unExcusingId) return;
    setSaving(true);
    try {
      await apiFetch(`/outstanding-balances/${unExcusingId}/excuse`, {
        method: "PATCH",
        auth: true,
        body: { isExcused: false },
      });
      setUnExcusingId(null);
      loadPage(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove excused status");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[140px] flex-1">
          <Label htmlFor="ob-term-filter">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="ob-term-filter" className="mt-1">
              <SelectValue placeholder="All terms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TERMS}>All terms</SelectItem>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px] flex-1">
          <Label htmlFor="ob-class-level-filter">Class level</Label>
          <Select value={classLevelId} onValueChange={setClassLevelId}>
            <SelectTrigger id="ob-class-level-filter" className="mt-1">
              <SelectValue placeholder="All class levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLASS_LEVELS}>All class levels</SelectItem>
              {classLevels.map((level) => (
                <SelectItem key={level.id} value={level.id}>
                  {level.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canFilterBySection && (
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="ob-section-filter">Section</Label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger id="ob-section-filter" className="mt-1">
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SECTIONS}>All sections</SelectItem>
                {(Object.keys(SECTION_LABEL) as ClassLevelCategoryGroup[]).map((group) => (
                  <SelectItem key={group} value={group}>
                    {SECTION_LABEL[group]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-w-[140px] flex-1">
          <Label htmlFor="ob-excused-filter">Excused</Label>
          <Select value={excusedFilter} onValueChange={(v) => setExcusedFilter(v as ExcusedFilter)}>
            <SelectTrigger id="ob-excused-filter" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(EXCUSED_LABEL) as ExcusedFilter[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {EXCUSED_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] flex-1">
          <Label htmlFor="ob-search">Search</Label>
          <Input
            id="ob-search"
            type="search"
            placeholder="Name or admission #…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      {rows.length === 0 && loading ? (
        <SkeletonTable rows={4} columns={5} />
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">S/N</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Class</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Overdue amount</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState icon={Wallet} title="No overdue balances" />
                  </td>
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={row.studentId} className="border-b border-border/60 last:border-none even:bg-card-inset">
                  <td className="py-2.5 pr-4 text-muted">{index + 1}</td>
                  <td className="py-2.5 pr-4 font-medium">
                    {row.firstName} {row.lastName}{" "}
                    <span className="font-mono text-muted">({row.admissionNumber})</span>
                    {row.isDebtExcused && (
                      <Badge variant="info" className="ml-2">
                        Excused
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted">{row.classArmName ?? "—"}</td>
                  <td className="py-2.5 pr-4 font-mono">{formatCurrency(row.totalOutstanding)}</td>
                  <td className="py-2.5 text-right">
                    {canExcuse &&
                      (row.isDebtExcused ? (
                        <AlertDialog open={unExcusingId === row.studentId} onOpenChange={(open) => setUnExcusingId(open ? row.studentId : null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-danger text-danger hover:border-danger hover:bg-danger-bg"
                            >
                              Remove excused
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle className="text-lg font-semibold">
                              Remove excused status for {row.firstName} {row.lastName}?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="mt-2 text-sm text-muted">
                              This student will no longer be flagged as excused from debt-collection scrutiny.
                            </AlertDialogDescription>
                            <div className="mt-4 flex justify-end gap-2">
                              <AlertDialogCancel asChild>
                                <Button variant="outline">Cancel</Button>
                              </AlertDialogCancel>
                              <Button disabled={saving} onClick={confirmUnExcuse}>
                                Confirm
                              </Button>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <AlertDialog
                          open={excusingId === row.studentId}
                          onOpenChange={(open) => {
                            setExcusingId(open ? row.studentId : null);
                            if (!open) setReason("");
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-info text-info hover:border-info hover:bg-info-bg"
                            >
                              Mark excused
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle className="text-lg font-semibold">
                              Mark {row.firstName} {row.lastName} as excused?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="mt-2 text-sm text-muted">
                              Informational only — their outstanding balance is unchanged, but Principal/Headteacher
                              will see this student is permitted to stay in class for now. Reversible any time.
                            </AlertDialogDescription>
                            <div className="mt-3">
                              <Label htmlFor="excuse-reason">Reason (optional)</Label>
                              <Textarea
                                id="excuse-reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={2}
                                className="mt-1"
                              />
                            </div>
                            <div className="mt-4 flex justify-end gap-2">
                              <AlertDialogCancel asChild>
                                <Button variant="outline">Cancel</Button>
                              </AlertDialogCancel>
                              <Button disabled={saving} onClick={confirmExcuse}>
                                Confirm
                              </Button>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={sentinelRef} />
          {loading && rows.length > 0 && <p className="py-2 text-center text-[11.5px] text-muted">Loading…</p>}
        </div>
      )}
    </div>
  );
}
