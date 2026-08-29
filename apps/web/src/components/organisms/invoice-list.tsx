"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
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
type InvoiceStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";
interface InvoiceListItem {
  id: string;
  status: InvoiceStatus;
  dueDate: string;
  outstandingBalance: number;
  term: { id: string; name: string };
  student: { admissionNumber: string; user: { firstName: string; lastName: string } };
}

const ALL_STATUSES = "__all__";
const STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  UNPAID: "muted",
  PARTIAL: "warning",
  PAID: "success",
  OVERDUE: "danger",
};

/**
 * Bursar/Super-Admin see every invoice (server-side term/status filters plus
 * a client-side name/admission-number search); a parent sees only her own
 * wards' invoices via the same endpoint's automatic scoping — no filters
 * shown, that scope is already small. Flat fetch (no pagination), same
 * "it's one school" precedent as PeopleList.
 */
export function InvoiceList({
  canManageFees,
  studentId,
  refreshKey,
  onSelect,
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
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState("");
  const [status, setStatus] = useState(ALL_STATUSES);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!canManageFees) return;
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, [canManageFees]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (canManageFees) {
      if (termId) params.set("termId", termId);
      if (status !== ALL_STATUSES) params.set("status", status);
    }
    if (studentId) params.set("studentId", studentId);
    const qs = params.toString();
    apiFetch<InvoiceListItem[]>(`/invoices${qs ? `?${qs}` : ""}`, { auth: true })
      .then(setInvoices)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load invoices"));
  }, [canManageFees, studentId, termId, status]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filteredInvoices = useMemo(() => {
    if (!invoices || !canManageFees) return invoices;
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter(
      (invoice) =>
        invoice.student.admissionNumber.toLowerCase().includes(term) ||
        `${invoice.student.user.firstName} ${invoice.student.user.lastName}`.toLowerCase().includes(term),
    );
  }, [invoices, search, canManageFees]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!invoices) return <SkeletonTable rows={4} columns={4} />;

  return (
    <div className="space-y-3">
      {canManageFees && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
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
          <div>
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
          <div>
            <Label htmlFor="inv-search">Search</Label>
            <Input
              id="inv-search"
              type="search"
              placeholder="Name or admission #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      )}

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">
                {canManageFees ? "Student" : "Child · Term"}
              </th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Due</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Balance</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices?.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState icon={Receipt} title="No invoices to show" />
                </td>
              </tr>
            )}
            {filteredInvoices?.map((invoice) => (
              <tr
                key={invoice.id}
                onClick={() => onSelect(invoice.id)}
                className="cursor-pointer border-b border-border/60 last:border-none hover:border-white"
              >
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
      </div>
    </div>
  );
}
