"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Skeleton } from "../atoms/skeleton";

interface StudentSearchResult {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface AssignmentItem {
  id: string;
  invoiceId: string | null;
  student: { id: string; admissionNumber: string; user: { firstName: string; lastName: string } };
}

/**
 * Bursar/Super-Admin-only panel mounted inline under one optional
 * (isMandatory=false) fee-structure row in FeeStructureManager. Lets the
 * Bursar search for a student (GET /students, backend-paginated/searched)
 * and opt them into that fee via POST /fee-structure-student-assignments —
 * staff-mediated, not parent self-service, since FeeStructure is never
 * exposed to parents.
 */
export function FeeStructureAssignmentPanel({ feeStructureId }: { feeStructureId: string }) {
  const [assignments, setAssignments] = useState<AssignmentItem[] | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAssignments = useCallback(() => {
    apiFetch<AssignmentItem[]>(`/fee-structure-student-assignments?feeStructureId=${feeStructureId}`, { auth: true })
      .then(setAssignments)
      .catch(() => setAssignments([]));
  }, [feeStructureId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    if (!search) {
      setResults([]);
      return;
    }
    apiFetch<{ data: StudentSearchResult[] }>(`/students?search=${encodeURIComponent(search)}&take=8`, { auth: true })
      .then((res) => setResults(res.data))
      .catch(() => setResults([]));
  }, [search]);

  const assignedStudentIds = new Set((assignments ?? []).map((a) => a.student.id));

  async function assign(studentId: string) {
    setError(null);
    setNotice(null);
    setSubmittingId(studentId);
    try {
      const result = await apiFetch<{ supplementaryInvoice: { id: string } | null }>("/fee-structure-student-assignments", {
        method: "POST",
        auth: true,
        body: { studentId, feeStructureId },
      });
      setNotice(
        result.supplementaryInvoice
          ? "Opted in — a new supplementary invoice was generated immediately."
          : "Opted in — will be billed the next time invoices are generated for this term.",
      );
      setSearchInput("");
      setResults([]);
      loadAssignments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to opt this student in");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-dashed border-border p-2.5 text-[12.5px]">
      {error && <p className="text-danger">{error}</p>}
      {notice && <p className="text-success">{notice}</p>}

      <Input placeholder="Search student by name or admission number…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((student) => (
            <li key={student.id} className="flex items-center justify-between gap-2">
              <span>
                {student.user.firstName} {student.user.lastName} <span className="font-mono text-muted">({student.admissionNumber})</span>
              </span>
              {assignedStudentIds.has(student.id) ? (
                <span className="text-muted">Already opted in</span>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={submittingId === student.id} onClick={() => assign(student.id)}>
                  {submittingId === student.id ? "Assigning…" : "Assign"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="text-muted">Currently opted in:</p>
        {assignments === null ? (
          <div className="space-y-1 pt-1">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        ) : assignments.length === 0 ? (
          <p className="text-muted">No students opted in yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {assignments.map((a) => (
              <li key={a.id}>
                {a.student.user.firstName} {a.student.user.lastName}{" "}
                <span className="font-mono text-muted">({a.student.admissionNumber})</span>{" "}
                <span className="text-muted">· {a.invoiceId ? "billed" : "pending next invoice"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
