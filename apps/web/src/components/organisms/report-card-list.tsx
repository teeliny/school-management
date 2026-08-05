"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge, type BadgeVariant } from "../atoms/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

type ReportType = "MID_TERM" | "FULL_TERM";
type ReportStatus = "GENERATING" | "READY" | "PUBLISHED" | "FAILED";

interface TermReportCardItem {
  id: string;
  studentId: string;
  termId: string;
  reportType: ReportType;
  status: ReportStatus;
  pdfUrl: string | null;
  overallScore: string | null;
  overallGrade: string | null;
}
interface StudentOption {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface TermOption {
  id: string;
  name: string;
}

const STATUS_VARIANT: Record<ReportStatus, BadgeVariant> = {
  GENERATING: "muted",
  READY: "info",
  PUBLISHED: "success",
  FAILED: "danger",
};
const TYPE_VARIANT: Record<ReportType, BadgeVariant> = {
  MID_TERM: "warning",
  FULL_TERM: "info",
};

export function ReportCardList({
  studentId,
  termId,
  students,
  terms,
  canManage,
  canDelete,
  refreshKey,
}: {
  studentId: string;
  termId: string;
  students: StudentOption[];
  terms: TermOption[];
  canManage: boolean;
  canDelete: boolean;
  refreshKey: number;
}) {
  const [cards, setCards] = useState<TermReportCardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (studentId) params.set("studentId", studentId);
    if (termId) params.set("termId", termId);
    const qs = params.toString();
    apiFetch<TermReportCardItem[]>(`/term-report-cards${qs ? `?${qs}` : ""}`, { auth: true })
      .then(setCards)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load report cards"));
  }, [studentId, termId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function publish(id: string) {
    setPublishing((s) => ({ ...s, [id]: true }));
    setError(null);
    try {
      await apiFetch(`/term-report-cards/${id}/publish`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish report card");
    } finally {
      setPublishing((s) => ({ ...s, [id]: false }));
    }
  }

  async function remove(id: string) {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/term-report-cards/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete report card");
    } finally {
      setDeleting(false);
    }
  }

  function studentLabel(id: string) {
    const student = students.find((s) => s.id === id);
    return student ? `${student.user.firstName} ${student.user.lastName} (${student.admissionNumber})` : id;
  }
  function termLabel(id: string) {
    return terms.find((t) => t.id === id)?.name ?? id;
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!cards) return <p className="text-sm text-muted">Loading…</p>;
  if (cards.length === 0) return <p className="text-sm text-muted">No report cards found.</p>;

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Student</th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Term</th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Type</th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Overall</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide"></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-3 font-medium">{studentLabel(card.studentId)}</td>
              <td className="py-2.5 pr-3">{termLabel(card.termId)}</td>
              <td className="py-2.5 pr-3">
                <Badge variant={TYPE_VARIANT[card.reportType]}>{card.reportType.replace("_", " ")}</Badge>
              </td>
              <td className="py-2.5 pr-3">
                <Badge variant={STATUS_VARIANT[card.status]}>{card.status}</Badge>
              </td>
              <td className="py-2.5 pr-3 font-mono text-muted">
                {card.overallScore ? `${card.overallScore} (${card.overallGrade})` : "—"}
              </td>
              <td className="py-2.5">
                <div className="flex justify-end gap-1.5">
                  {card.pdfUrl && (
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a href={card.pdfUrl} target="_blank" rel="noreferrer">
                        View PDF
                      </a>
                    </Button>
                  )}
                  {canManage && card.status === "READY" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={publishing[card.id]}
                      onClick={() => publish(card.id)}
                    >
                      Publish
                    </Button>
                  )}
                  {canDelete && (
                    <AlertDialog
                      open={deletingId === card.id}
                      onOpenChange={(open) => setDeletingId(open ? card.id : null)}
                    >
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle className="text-lg font-semibold">
                          Delete this report card?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="mt-2 text-sm text-muted">
                          {studentLabel(card.studentId)} — {termLabel(card.termId)} (
                          {card.reportType.replace("_", " ")}). This cannot be undone.
                        </AlertDialogDescription>
                        <div className="mt-4 flex justify-end gap-2">
                          <AlertDialogCancel asChild>
                            <Button variant="outline">Cancel</Button>
                          </AlertDialogCancel>
                          <Button disabled={deleting} onClick={() => remove(card.id)}>
                            Confirm delete
                          </Button>
                        </div>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
