"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import type { ClassLevelCategory, ClassLevelCategoryGroup } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
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
const ALL_CLASS_LEVELS = "__all_class_levels__";
const ALL_SECTIONS = "__all_sections__";
const SECTION_LABEL: Record<ClassLevelCategoryGroup, string> = {
  JSS_SSS: "Secondary",
  CRECHE_NURSERY_PRIMARY: "Primary",
};
type InvoiceStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";
interface InvoiceListItem {
  id: string;
  status: InvoiceStatus;
  dueDate: string;
  outstandingBalance: number;
  term: { id: string; name: string };
  student: { admissionNumber: string; user: { firstName: string; lastName: string } };
}
interface InvoicesPage {
  data: InvoiceListItem[];
  total: number;
}

const ALL_STATUSES = "__all__";
const STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  UNPAID: "muted",
  PARTIAL: "warning",
  PAID: "success",
  OVERDUE: "danger",
};
const PAGE_SIZE = 25;

/**
 * Bursar/Super-Admin see every invoice (server-side term/status/class-level/
 * section/search filters, backend-paginated); a parent sees only her own
 * wards' invoices via the same endpoint's automatic scoping — no filters
 * shown, that scope is already small, but still paginated the same way for
 * one consistent code path. Scrolls to load more (useInfiniteScroll), same
 * pattern as GradebookTable/usePaginatedStudents.
 */
export function InvoiceList({
  canManageFees,
  studentId,
  refreshKey,
  onSelect,
  onTotalChange,
}: {
  canManageFees: boolean;
  // A student profile's "Fees" quick link — narrows to one student's
  // invoices. Safe to apply even for a Parent (whose invoices are already
  // scoped server-side to her own wards): InvoiceService.findAllForUser ANDs
  // this onto that scope rather than replacing it, so passing a studentId
  // that isn't actually her ward just yields zero rows, not a leak.
  studentId?: string;
  refreshKey?: unknown;
  onSelect: (invoiceId: string) => void;
  // Reports the current filtered/searched total up to the caller so it can
  // show "Invoices (N)" at the top of the panel, above this component's own
  // filter bar.
  onTotalChange?: (total: number) => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [termId, setTermId] = useState("");
  const [status, setStatus] = useState(ALL_STATUSES);
  const [classLevelId, setClassLevelId] = useState(ALL_CLASS_LEVELS);
  const [section, setSection] = useState(ALL_SECTIONS);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  // Guards against an in-flight request from a superseded filter set
  // resolving after a newer one and clobbering the list with stale data —
  // same precedent as usePaginatedStudents.
  const requestId = useRef(0);

  useEffect(() => {
    if (!canManageFees) return;
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
  }, [canManageFees]);

  const loadPage = useCallback(
    (skip: number) => {
      const thisRequest = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
      if (canManageFees) {
        if (termId) params.set("termId", termId);
        if (status !== ALL_STATUSES) params.set("status", status);
        if (classLevelId !== ALL_CLASS_LEVELS) params.set("classLevelId", classLevelId);
        if (section !== ALL_SECTIONS) params.set("classLevelCategoryGroup", section);
        if (search) params.set("search", search);
      }
      if (studentId) params.set("studentId", studentId);
      apiFetch<InvoicesPage>(`/invoices?${params.toString()}`, { auth: true })
        .then((res) => {
          if (thisRequest !== requestId.current) return;
          setInvoices((prev) => (skip === 0 ? res.data : [...prev, ...res.data]));
          setTotal(res.total);
        })
        .catch((err) => {
          if (thisRequest !== requestId.current) return;
          setError(err instanceof ApiError ? err.message : "Failed to load invoices");
        })
        .finally(() => {
          if (thisRequest === requestId.current) setLoading(false);
        });
    },
    [canManageFees, studentId, termId, status, classLevelId, section, search],
  );

  // `loadPage`'s own deps mirror every filter here, so its identity already
  // changes exactly when a reset-to-page-0 is needed — `refreshKey` is the
  // one trigger outside that (a sibling action, e.g. Generate Invoices,
  // created new rows this list didn't cause itself).
  useEffect(() => {
    loadPage(0);
  }, [loadPage, refreshKey]);

  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  const hasMore = invoices.length < total;
  const sentinelRef = useInfiniteScroll({ onLoadMore: () => loadPage(invoices.length), hasMore, loading });

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (invoices.length === 0 && loading) return <SkeletonTable rows={4} columns={5} />;

  return (
    <div className="space-y-3">
      {canManageFees && (
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="inv-term-filter">Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger id="inv-term-filter" className="mt-1">
                <SelectValue placeholder="All terms" />
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
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="inv-status-filter">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="inv-status-filter" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                {(Object.keys(STATUS_VARIANT) as InvoiceStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[150px] flex-1">
            <Label htmlFor="inv-class-level-filter">Class level</Label>
            <Select value={classLevelId} onValueChange={setClassLevelId}>
              <SelectTrigger id="inv-class-level-filter" className="mt-1">
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
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="inv-section-filter">Section</Label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger id="inv-section-filter" className="mt-1">
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
          <div className="min-w-[160px] flex-1">
            <Label htmlFor="inv-search">Search</Label>
            <Input
              id="inv-search"
              type="search"
              placeholder="Name or admission #…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      )}

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">S/N</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">
                {canManageFees ? "Student" : "Child · Term"}
              </th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Due</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Balance</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={Receipt} title="No invoices to show" />
                </td>
              </tr>
            )}
            {invoices.map((invoice, index) => (
              <tr
                key={invoice.id}
                onClick={() => onSelect(invoice.id)}
                className="cursor-pointer border-b border-border/60 last:border-none hover:border-white even:bg-card-inset"
              >
                <td className="py-2.5 pr-4 text-muted">{index + 1}</td>
                <td className="py-2.5 pr-4 font-medium">
                  {canManageFees ? (
                    <>
                      {invoice.student.user.firstName} {invoice.student.user.lastName}{" "}
                      <span className="font-mono text-muted">({invoice.student.admissionNumber})</span>
                    </>
                  ) : (
                    <>
                      {invoice.student.user.firstName} {invoice.student.user.lastName}{" "}
                      <span className="text-muted">· {invoice.term.name}</span>
                    </>
                  )}
                </td>
                <td className="py-2.5 pr-4 font-mono text-muted">{invoice.dueDate.slice(0, 10)}</td>
                <td className="py-2.5 pr-4 font-mono">{formatCurrency(invoice.outstandingBalance)}</td>
                <td className="py-2.5">
                  <Badge variant={STATUS_VARIANT[invoice.status]}>{invoice.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={sentinelRef} />
        {loading && invoices.length > 0 && <p className="py-2 text-center text-[11.5px] text-muted">Loading…</p>}
      </div>
    </div>
  );
}
