"use client";

import { useRef, useState } from "react";
import { FileCheck2, Paperclip, X } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import {
  HOMEWORK_FILE_ACCEPT,
  HOMEWORK_MAX_FILE_BYTES,
  maxScoreOf,
  uploadHomeworkFile,
  type HomeworkDetail,
  type HomeworkRosterRow,
} from "../../lib/homework";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Textarea } from "../atoms/textarea";

const BLOCKED_KEYS = new Set(["-", "+", "e", "E"]);

/**
 * PRD §3.6a: per-student marking for one homework — score (when the
 * homework has a max score), a written correction, and an optional
 * correction file. Saving a mark notifies the student and their guardians;
 * it never touches the gradebook (that's the separate, explicit transfer).
 */
export function HomeworkMarkingTable({ homework, onChanged }: { homework: HomeworkDetail; onChanged: () => void }) {
  const max = maxScoreOf(homework);
  const markedCount = homework.roster.filter((r) => r.mark).length;
  const submittedCount = homework.roster.filter((r) => r.submission).length;

  if (homework.roster.length === 0) {
    return <p className="text-sm text-muted">No students are enrolled in this subject for this class and term.</p>;
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-muted">
        {markedCount} of {homework.roster.length} marked
        {homework.allowOnlineSubmission && ` · ${submittedCount} submitted online`}
      </p>
      {homework.status === "DRAFT" && (
        <p className="text-[12px] text-warning">Publish this homework before marking — students can&apos;t see it yet.</p>
      )}
      <ul className="space-y-2">
        {homework.roster.map((row) => (
          <MarkRow
            key={row.student.id}
            homework={homework}
            row={row}
            max={max}
            disabled={homework.status === "DRAFT" || !homework.viewerCanManage}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function MarkRow({
  homework,
  row,
  max,
  disabled,
  onChanged,
}: {
  homework: HomeworkDetail;
  row: HomeworkRosterRow;
  max: number | null;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [score, setScore] = useState(row.mark?.score !== null && row.mark?.score !== undefined ? String(Number(row.mark.score)) : "");
  const [correction, setCorrection] = useState(row.mark?.correction ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty =
    score !== (row.mark?.score !== null && row.mark?.score !== undefined ? String(Number(row.mark.score)) : "") ||
    correction !== (row.mark?.correction ?? "");

  async function save() {
    setError(null);
    let parsed: number | null = null;
    if (max !== null) {
      parsed = Number(score);
      if (score.trim() === "" || Number.isNaN(parsed) || parsed < 0 || parsed > max) {
        setError(`Score must be 0–${max}`);
        return;
      }
    }
    setStatus("saving");
    try {
      await apiFetch(`/homework/${homework.id}/marks/${row.student.id}`, {
        method: "PUT",
        auth: true,
        body: { score: parsed, correction: correction.trim() || null },
      });
      setStatus("saved");
      onChanged();
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Failed to save mark");
    }
  }

  async function uploadCorrection(file: File | undefined) {
    if (!file) return;
    if (file.size > HOMEWORK_MAX_FILE_BYTES) {
      setError(`${file.name} is larger than 10 MB`);
      return;
    }
    setError(null);
    try {
      await uploadHomeworkFile(`/homework/${homework.id}/marks/${row.student.id}/correction-file`, file);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to upload correction file");
    }
  }

  async function removeCorrection() {
    try {
      await apiFetch(`/homework/${homework.id}/marks/${row.student.id}/correction-file`, { method: "DELETE", auth: true });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove correction file");
    }
  }

  return (
    <li className="rounded-lg border border-border p-3 even:bg-card-inset">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium">
          {formatPersonName(row.student)} <span className="font-mono text-muted">({row.student.admissionNumber})</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {homework.allowOnlineSubmission || row.submission ? (
            row.submission ? (
              <Badge variant={row.submission.isLate ? "warning" : "info"}>{row.submission.isLate ? "Submitted late" : "Submitted"}</Badge>
            ) : (
              <Badge variant="muted">Not submitted</Badge>
            )
          ) : null}
          {row.mark ? <Badge variant="success">Marked</Badge> : <Badge variant="muted">Pending</Badge>}
          {row.mark?.changedSinceTransfer && <Badge variant="warning">Changed since transfer</Badge>}
        </div>
      </div>

      {row.submission && (
        <div className="mt-2 rounded-md bg-card-inset px-3 py-2 text-[12px]">
          {row.submission.text && <p className="whitespace-pre-wrap">{row.submission.text}</p>}
          {row.submission.files.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {row.submission.files.map((f) => (
                <li key={f.id} className="flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3 text-muted" />
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
                    {f.fileName}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 font-mono text-[10.5px] text-muted">
            Submitted {new Date(row.submission.updatedAt).toLocaleString()}
          </p>
        </div>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-start">
        {max !== null ? (
          <div>
            <Input
              type="number"
              min={0}
              max={max}
              step="any"
              aria-label={`Score out of ${max}`}
              className="text-center font-mono"
              value={score}
              disabled={disabled}
              onKeyDown={(e) => {
                if (BLOCKED_KEYS.has(e.key)) e.preventDefault();
              }}
              onChange={(e) => {
                setScore(e.target.value);
                setStatus("idle");
              }}
            />
            <div className="mt-0.5 text-center font-mono text-[10.5px] text-muted">/ {max}</div>
          </div>
        ) : (
          <div className="pt-2 text-[11.5px] text-muted">No score</div>
        )}
        <Textarea
          rows={2}
          aria-label="Correction"
          placeholder="Correction / feedback for the student and parent"
          value={correction}
          disabled={disabled}
          onChange={(e) => {
            setCorrection(e.target.value);
            setStatus("idle");
          }}
        />
        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <Button type="button" size="sm" disabled={disabled || status === "saving" || (!dirty && row.mark !== null)} onClick={save}>
            {status === "saving" ? "Saving…" : row.mark ? "Update" : "Save mark"}
          </Button>
          {status === "saved" && !dirty && <span className="text-[11px] text-success">Saved</span>}
        </div>
      </div>

      {row.mark && (
        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
          {row.mark.correctionUrl ? (
            <>
              <FileCheck2 className="h-3.5 w-3.5 text-muted" />
              <a href={row.mark.correctionUrl} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
                {row.mark.correctionFileName}
              </a>
              {!disabled && (
                <button type="button" aria-label="Remove correction file" onClick={removeCorrection} className="text-muted hover:text-danger">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (
            !disabled && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={HOMEWORK_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    void uploadCorrection(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-1 text-muted hover:text-foreground">
                  <Paperclip className="h-3.5 w-3.5" /> Attach marked script / correction file
                </button>
              </>
            )
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
    </li>
  );
}
