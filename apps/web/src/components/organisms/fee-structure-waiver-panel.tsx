"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
import { Input } from "../atoms/input";

interface StudentSearchResult {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface BulkWaiveFeeResult {
  requested: number;
  skipped: { studentId: string; reason: string }[];
}

/**
 * Bursar/Super-Admin-only panel mounted inline under a MANDATORY
 * fee-structure row in FeeStructureManager — the mirror image of
 * FeeStructureAssignmentPanel's opt-in flow for optional fees. Selected
 * students each get a fee-waiver DiscountRequest raised via
 * POST /discount-requests/bulk-waive-fee (amount is server-computed from
 * the actual billed line, never entered here); a Super-Admin still has to
 * approve each one from the pending-approvals queue.
 */
export function FeeStructureWaiverPanel({ feeStructureId }: { feeStructureId: string }) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [selected, setSelected] = useState<Map<string, StudentSearchResult>>(new Map());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkWaiveFeeResult | null>(null);

  useEffect(() => {
    if (!search) {
      setResults([]);
      return;
    }
    apiFetch<{ data: StudentSearchResult[] }>(`/students?search=${encodeURIComponent(search)}&take=8`, { auth: true })
      .then((res) => setResults(res.data))
      .catch(() => setResults([]));
  }, [search]);

  function toggle(student: StudentSearchResult) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(student.id)) next.delete(student.id);
      else next.set(student.id, student);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkWaiveFeeResult>("/discount-requests/bulk-waive-fee", {
        method: "POST",
        auth: true,
        body: { feeStructureId, studentIds: [...selected.keys()], reason },
      });
      setResult(res);
      setSelected(new Map());
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit waiver request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-dashed border-border p-2.5 text-[12.5px]">
      {error && <p className="text-danger">{error}</p>}
      {result && (
        <div className="text-muted">
          <p>
            {result.requested} waiver{result.requested === 1 ? "" : "s"} submitted for Super-Admin approval.
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {result.skipped.map((s) => (
                <li key={s.studentId}>Skipped one student — {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Input
        placeholder="Search student by name or admission number…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((student) => (
            <li key={student.id} className="flex items-center gap-2">
              <Checkbox checked={selected.has(student.id)} onCheckedChange={() => toggle(student)} />
              <span>
                {student.user.firstName} {student.user.lastName} <span className="font-mono text-muted">({student.admissionNumber})</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {selected.size > 0 && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p className="text-muted">{selected.size} student(s) selected</p>
          <Input placeholder="Reason (e.g. not participating)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="button" size="sm" disabled={submitting || !reason.trim()} onClick={handleSubmit}>
            {submitting ? "Submitting…" : `Waive for ${selected.size} student(s)`}
          </Button>
        </div>
      )}
    </div>
  );
}
