"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import type { HomeworkDetail, HomeworkTransferPlan } from "../../lib/homework";
import { Button } from "../atoms/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../molecules/dialog";

/**
 * PRD §3.6a: the one opt-in bridge from homework into term grading. Shows
 * exactly what will be written (scaled score per student, anything it will
 * overwrite, who's skipped for being unmarked) before the teacher confirms.
 * The API writes each row through the normal gradebook path, so a CA that
 * isn't OPEN is refused just like manual score entry.
 */
export function HomeworkTransferDialog({ homework, onTransferred }: { homework: HomeworkDetail; onTransferred: () => void }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<HomeworkTransferPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setPlan(null);
    setError(null);
    setResult(null);
    try {
      setPlan(await apiFetch<HomeworkTransferPlan>(`/homework/${homework.id}/transfer-preview`, { auth: true }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load transfer preview");
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ transferred: number; skippedUnmarked: number }>(`/homework/${homework.id}/transfer`, {
        method: "POST",
        auth: true,
      });
      setResult(
        `${res.transferred} score${res.transferred === 1 ? "" : "s"} written to the gradebook` +
          (res.skippedUnmarked > 0 ? `, ${res.skippedUnmarked} unmarked student${res.skippedUnmarked === 1 ? "" : "s"} skipped.` : "."),
      );
      onTransferred();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  const overwrites = plan?.rows.filter((r) => r.existingScore !== null && !r.existingFromThisHomework && r.existingScore !== r.scaledScore) ?? [];

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openDialog}>
        Transfer to gradebook
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="font-display text-[15.5px] font-semibold">Transfer to gradebook</DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-muted">
            {plan
              ? `Scores out of ${plan.homeworkMaxScore} will be scaled to ${plan.component.name} (out of ${plan.component.maxScore}).`
              : "Loading preview…"}
          </DialogDescription>

          {plan && !result && (
            <div className="mt-3 max-h-[50vh] space-y-3 overflow-y-auto text-[12.5px]">
              {plan.component.status !== "OPEN" && (
                <p className="rounded-md bg-warning-bg px-3 py-2 text-warning">
                  {plan.component.name} is {plan.component.status}. Subject teachers can only write to an OPEN CA, but Admin and Super-Admin can override.
                </p>
              )}
              {overwrites.length > 0 && (
                <p className="rounded-md bg-warning-bg px-3 py-2 text-warning">
                  {overwrites.length} student{overwrites.length === 1 ? " already has" : "s already have"} a different {plan.component.name} score that
                  will be replaced.
                </p>
              )}
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-1.5 pr-2">Student</th>
                    <th className="py-1.5 pr-2">Homework</th>
                    <th className="py-1.5 pr-2">{plan.component.name}</th>
                    <th className="py-1.5">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.studentId} className="border-b border-border/60 last:border-none">
                      <td className="py-1.5 pr-2">{r.studentName}</td>
                      <td className="py-1.5 pr-2 font-mono">{r.homeworkScore}/{plan.homeworkMaxScore}</td>
                      <td className="py-1.5 pr-2 font-mono font-semibold">{r.scaledScore}</td>
                      <td className="py-1.5 font-mono text-muted">{r.existingScore ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.unmarked.length > 0 && (
                <p className="text-muted">
                  Skipped (not marked yet — no score will be written): {plan.unmarked.map((u) => u.studentName).join(", ")}
                </p>
              )}
            </div>
          )}

          {result && <p className="mt-3 text-[12.5px] text-success">{result}</p>}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button type="button" size="sm" disabled={!plan || plan.rows.length === 0 || busy} onClick={confirm}>
                {busy ? "Transferring…" : `Write ${plan?.rows.length ?? 0} score${plan?.rows.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
