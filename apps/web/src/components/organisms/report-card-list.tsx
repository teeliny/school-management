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
  needsRegeneration: boolean;
  student: { admissionNumber: string; user: { firstName: string; lastName: string } };
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

// Publish-gate failures come straight from TermReportCardService's
// BadRequestException messages (apps/api/src/assessments/term-report-card.ts)
// — translate the ones a non-technical Admin will actually hit into plain
// language instead of showing raw model names like "SubjectTermResult".
function friendlyPublishError(message: string): string {
  if (message.startsWith("Missing SubjectTermResult")) {
    return "This report can't be published yet — the term's assessment components haven't all closed, so subject results haven't been finalized.";
  }
  if (message.startsWith("Missing SkillRating")) {
    return "This report can't be published yet — not every skill rating has been entered for this student.";
  }
  if (message === "Missing CLASS_TEACHER comment") {
    return "This report can't be published yet — the class teacher's comment is missing.";
  }
  if (message === "Missing PRINCIPAL comment") {
    return "This report can't be published yet — the principal's comment is missing.";
  }
  if (message.startsWith("Cannot publish a report card with status")) {
    return "This report card isn't ready to publish yet.";
  }
  return message;
}

export function ReportCardList({
  studentId,
  termId,
  classArmId,
  terms,
  canManage,
  canDelete,
  refreshKey,
}: {
  studentId: string;
  termId: string;
  classArmId: string;
  terms: TermOption[];
  canManage: boolean;
  canDelete: boolean;
  refreshKey: number;
}) {
  const [cards, setCards] = useState<TermReportCardItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (studentId) params.set("studentId", studentId);
    if (termId) params.set("termId", termId);
    if (classArmId) params.set("classArmId", classArmId);
    const qs = params.toString();
    apiFetch<TermReportCardItem[]>(`/term-report-cards${qs ? `?${qs}` : ""}`, { auth: true })
      .then((data) => {
        setCards(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load report cards"));
  }, [studentId, termId, classArmId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function publish(id: string) {
    setPublishing((s) => ({ ...s, [id]: true }));
    setActionError(null);
    try {
      await apiFetch(`/term-report-cards/${id}/publish`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? friendlyPublishError(err.message) : "Failed to publish report card");
    } finally {
      setPublishing((s) => ({ ...s, [id]: false }));
    }
  }

  async function regenerate(id: string) {
    setRegenerating((s) => ({ ...s, [id]: true }));
    setActionError(null);
    try {
      await apiFetch(`/term-report-cards/${id}/regenerate`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to regenerate report card");
    } finally {
      setRegenerating((s) => ({ ...s, [id]: false }));
    }
  }

  async function remove(id: string) {
    setDeleting(true);
    setActionError(null);
    try {
      await apiFetch(`/term-report-cards/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to delete report card");
    } finally {
      setDeleting(false);
    }
  }

  function studentLabel(card: TermReportCardItem) {
    return `${card.student.user.firstName} ${card.student.user.lastName} (${card.student.admissionNumber})`;
  }
  function termLabel(id: string) {
    return terms.find((t) => t.id === id)?.name ?? id;
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!cards) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      {actionError && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-danger/70 hover:text-danger"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {cards.length === 0 ? (
        <p className="text-sm text-muted">No report cards found.</p>
      ) : (
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
              <td className="py-2.5 pr-3 font-medium">{studentLabel(card)}</td>
              <td className="py-2.5 pr-3">{termLabel(card.termId)}</td>
              <td className="py-2.5 pr-3">
                <Badge variant={TYPE_VARIANT[card.reportType]}>{card.reportType.replace("_", " ")}</Badge>
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant={STATUS_VARIANT[card.status]}>{card.status}</Badge>
                  {card.needsRegeneration && <Badge variant="warning">Needs regeneration</Badge>}
                </div>
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
                  {canManage && card.needsRegeneration && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={regenerating[card.id]}
                      onClick={() => regenerate(card.id)}
                    >
                      {regenerating[card.id] ? "Regenerating…" : "Regenerate"}
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
                          {studentLabel(card)} — {termLabel(card.termId)} (
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
      )}
    </div>
  );
}
