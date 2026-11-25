"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";

type PlanStatus = "PENDING" | "ALREADY_INVOICED" | "NO_APPLICABLE_FEES";
interface PreviewStudent {
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  className: string | null;
  status: PlanStatus;
  lines: { feeStructureId: string; name: string; amount: number; isMandatory: boolean }[];
  totalAmount: number;
}
interface PreviewResult {
  students: PreviewStudent[];
  summary: { pending: number; alreadyInvoiced: number; noApplicableFees: number; pendingTotalAmount: number };
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  PENDING: "To be invoiced",
  NO_APPLICABLE_FEES: "No applicable fees",
  ALREADY_INVOICED: "Already invoiced",
};
const STATUS_VARIANT: Record<PlanStatus, BadgeVariant> = {
  PENDING: "warning",
  NO_APPLICABLE_FEES: "muted",
  ALREADY_INVOICED: "success",
};
const ALL = "ALL";

/**
 * GET /invoices/preview — a read-only dry run of POST /invoices/generate for
 * the same term/class-level scope (both come from InvoiceService.plan, so
 * this is exactly what Generate will bill). Lists every active student in
 * scope with their status; expanding a "To be invoiced" student shows the
 * fee lines and total their invoice will get, so the Bursar can confirm the
 * right fees apply (e.g. an optional fee opt-in was recorded) before
 * generating.
 */
export function InvoiceGenerationPreview({
  termId,
  classLevelId,
  refreshKey,
}: {
  termId: string;
  classLevelId?: string;
  refreshKey?: unknown;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PlanStatus | typeof ALL>("PENDING");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    const params = new URLSearchParams({ termId });
    if (classLevelId) params.set("classLevelId", classLevelId);
    apiFetch<PreviewResult>(`/invoices/preview?${params.toString()}`, { auth: true })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load invoice preview");
      });
    return () => {
      cancelled = true;
    };
  }, [termId, classLevelId, refreshKey]);

  const visible = useMemo(() => {
    if (!preview) return [];
    const query = search.trim().toLowerCase();
    return preview.students.filter(
      (s) =>
        (statusFilter === ALL || s.status === statusFilter) &&
        (!query ||
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(query) ||
          s.admissionNumber.toLowerCase().includes(query)),
    );
  }, [preview, statusFilter, search]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!preview) return <SkeletonList rows={3} />;

  const { summary } = preview;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px]">
        <span className="font-medium">{summary.pending}</span> student(s) to be invoiced, totalling{" "}
        <span className="font-mono">{formatCurrency(summary.pendingTotalAmount)}</span>
        <span className="text-muted">
          {" "}
          · {summary.alreadyInvoiced} already invoiced · {summary.noApplicableFees} with no applicable fees
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PlanStatus | typeof ALL)}>
          <SelectTrigger className="w-[200px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">To be invoiced ({summary.pending})</SelectItem>
            <SelectItem value="NO_APPLICABLE_FEES">No applicable fees ({summary.noApplicableFees})</SelectItem>
            <SelectItem value="ALREADY_INVOICED">Already invoiced ({summary.alreadyInvoiced})</SelectItem>
            <SelectItem value={ALL}>All students ({preview.students.length})</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search name or admission no."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Users} title="No students match" />
      ) : (
        <ul className="max-h-[420px] space-y-1.5 overflow-y-auto text-[12.5px]">
          {visible.map((student) => {
            const expandable = student.status === "PENDING";
            const expanded = expandedId === student.studentId;
            return (
              <li key={student.studentId} className="rounded-lg border border-border">
                <button
                  type="button"
                  disabled={!expandable}
                  onClick={() => setExpandedId(expanded ? null : student.studentId)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-2.5 text-left disabled:cursor-default"
                  aria-expanded={expandable ? expanded : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    {expandable ? (
                      expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted" />
                      )
                    ) : (
                      <span className="inline-block w-3.5" />
                    )}
                    <span>
                      {formatPersonName(student)} <span className="font-mono text-muted">({student.admissionNumber})</span>
                      {student.className && <span className="text-muted"> · {student.className}</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {expandable && <span className="font-mono">{formatCurrency(student.totalAmount)}</span>}
                    <Badge variant={STATUS_VARIANT[student.status]}>{STATUS_LABEL[student.status]}</Badge>
                  </span>
                </button>
                {expandable && expanded && (
                  <table className="mx-2.5 mb-2.5 w-[calc(100%-1.25rem)] border-t border-border text-left">
                    <tbody>
                      {student.lines.map((line) => (
                        <tr key={line.feeStructureId} className="border-b border-border/60 last:border-none">
                          <td className="py-1.5 pr-4">
                            {line.name}
                            {!line.isMandatory && <span className="text-muted"> (optional, opted in)</span>}
                          </td>
                          <td className="py-1.5 text-right font-mono">{formatCurrency(line.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td className="py-1.5 pr-4">Total</td>
                        <td className="py-1.5 text-right font-mono">{formatCurrency(student.totalAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
