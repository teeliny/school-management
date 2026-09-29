"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenCheck, ChevronDown, ChevronRight, FileCheck2, Paperclip, X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import {
  formatDueDate,
  formatFileSize,
  HOMEWORK_FILE_ACCEPT,
  HOMEWORK_MAX_FILE_BYTES,
  isOverdue,
  maxScoreOf,
  uploadHomeworkFile,
  type HomeworkDetail,
  type HomeworkListItem,
} from "../../lib/homework";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Textarea } from "../atoms/textarea";
import { EmptyState } from "../molecules/empty-state";
import { cn } from "../../lib/cn";

/**
 * PRD §3.6a — the parent/student side: one student's published homework,
 * each expandable to its instructions, attachments, and — once marked —
 * the score and the teacher's correction. When the teacher enabled online
 * submission, the student (or their parent) can upload work here until
 * it's marked.
 *
 * `limit` gives the compact dashboard variant (most recent N, no term
 * filter UI) — the full list lives on /assignments.
 */
export function WardHomeworkList({ studentId, termId, limit }: { studentId: string; termId?: string; limit?: number }) {
  const [items, setItems] = useState<HomeworkListItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ studentId });
    if (termId) params.set("termId", termId);
    apiFetch<HomeworkListItem[]>(`/homework?${params.toString()}`, { auth: true })
      .then(setItems)
      .catch(() => setItems([]));
  }, [studentId, termId]);

  useEffect(() => {
    setItems(null);
    setExpandedId(null);
    load();
  }, [load]);

  if (!items) return <p className="text-sm text-muted">Loading…</p>;
  if (items.length === 0) {
    return <EmptyState icon={BookOpenCheck} title="No assignments yet" description="Assignments from subject teachers will appear here." />;
  }

  const shown = limit ? items.slice(0, limit) : items;

  return (
    <ul className="space-y-2">
      {shown.map((item) => {
        const mark = item.marks.find((m) => m.studentId === studentId);
        const submission = item.submissions.find((s) => s.studentId === studentId);
        const max = maxScoreOf(item);
        const expanded = expandedId === item.id;
        return (
          <li key={item.id} className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : item.id)}
            >
              <div className="flex min-w-0 items-start gap-2">
                {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 flex-none text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-muted" />}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{item.title}</div>
                  <div className="text-[11.5px] text-muted">
                    {item.subject.name} · due <span className="font-mono">{formatDueDate(item.dueDate)}</span>
                    {item.caComponent && ` · counts toward ${item.caComponent.name}`}
                  </div>
                </div>
              </div>
              <div className="flex flex-none flex-wrap justify-end gap-1.5">
                {mark ? (
                  <Badge variant="success">{max !== null && mark.score !== null ? `Marked ${Number(mark.score)}/${max}` : "Marked"}</Badge>
                ) : submission ? (
                  <Badge variant={submission.isLate ? "warning" : "info"}>{submission.isLate ? "Submitted late" : "Submitted"}</Badge>
                ) : item.status === "CLOSED" ? (
                  <Badge variant="muted">Closed</Badge>
                ) : isOverdue(item.dueDate) ? (
                  <Badge variant="danger">Overdue</Badge>
                ) : (
                  <Badge variant="muted">Pending</Badge>
                )}
              </div>
            </button>
            {expanded && (
              <div className="border-t border-border px-3 py-3">
                <WardHomeworkDetail homeworkId={item.id} studentId={studentId} onChanged={load} />
              </div>
            )}
          </li>
        );
      })}
      {limit && items.length > limit && (
        <li className="text-right">
          <a href="/assignments" className="text-[12px] text-primary underline hover:no-underline">
            View all {items.length} assignments
          </a>
        </li>
      )}
    </ul>
  );
}

function WardHomeworkDetail({ homeworkId, studentId, onChanged }: { homeworkId: string; studentId: string; onChanged: () => void }) {
  const [homework, setHomework] = useState<HomeworkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<HomeworkDetail>(`/homework/${homeworkId}`, { auth: true })
      .then(setHomework)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load assignment"));
  }, [homeworkId]);

  useEffect(load, [load]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!homework) return <p className="text-sm text-muted">Loading…</p>;

  const row = homework.roster.find((r) => r.student.id === studentId);
  const max = maxScoreOf(homework);
  const canSubmit = homework.allowOnlineSubmission && homework.status === "PUBLISHED" && !row?.mark;

  return (
    <div className="space-y-3 text-[12.5px]">
      <p className="whitespace-pre-wrap text-[13px]">{homework.instructions}</p>
      <p className="text-[11.5px] text-muted">
        Set by {homework.createdByUser.firstName} {homework.createdByUser.lastName}
        {max !== null && <> · marked out of <span className="font-mono">{max}</span></>}
      </p>
      {homework.attachments.length > 0 && (
        <ul className="space-y-1">
          {homework.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 text-muted" />
              <a href={a.url} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
                {a.fileName}
              </a>
              <span className="font-mono text-[11px] text-muted">{formatFileSize(a.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}

      {row?.mark && (
        <div className="rounded-lg bg-success-bg/60 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted">Teacher&apos;s mark</span>
            {max !== null && row.mark.score !== null && (
              <span className="font-mono text-[15px] font-semibold">
                {Number(row.mark.score)}
                <span className="text-muted">/{max}</span>
              </span>
            )}
          </div>
          {row.mark.correction && <p className="mt-1.5 whitespace-pre-wrap">{row.mark.correction}</p>}
          {row.mark.correctionUrl && (
            <a href={row.mark.correctionUrl} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1.5 text-primary underline hover:no-underline">
              <FileCheck2 className="h-3.5 w-3.5" /> {row.mark.correctionFileName}
            </a>
          )}
          <p className="mt-1.5 font-mono text-[10.5px] text-muted">Marked {new Date(row.mark.updatedAt).toLocaleString()}</p>
        </div>
      )}

      {row?.submission && !canSubmit && (
        <div className="rounded-lg bg-card-inset px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">Submitted work{row.submission.isLate && " (late)"}</div>
          {row.submission.text && <p className="mt-1 whitespace-pre-wrap">{row.submission.text}</p>}
          <FileList files={row.submission.files} />
        </div>
      )}

      {canSubmit && row && (
        <SubmissionForm
          homeworkId={homework.id}
          studentId={studentId}
          existing={row.submission}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
      {!homework.allowOnlineSubmission && !row?.mark && (
        <p className="text-[11.5px] text-muted">Hand this work in to the teacher in class.</p>
      )}
    </div>
  );
}

function FileList({ files, onRemove }: { files: { id: string; fileName: string; url: string }[]; onRemove?: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-1.5">
          <Paperclip className="h-3 w-3 text-muted" />
          <a href={f.url} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
            {f.fileName}
          </a>
          {onRemove && (
            <button type="button" aria-label={`Remove ${f.fileName}`} onClick={() => onRemove(f.id)} className="text-muted hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SubmissionForm({
  homeworkId,
  studentId,
  existing,
  onChanged,
}: {
  homeworkId: string;
  studentId: string;
  existing: HomeworkDetail["roster"][number]["submission"];
  onChanged: () => void;
}) {
  const [text, setText] = useState(existing?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `/homework/${homeworkId}/submissions/${studentId}`;

  async function saveText() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(base, { method: "PUT", auth: true, body: { text: text.trim() || null } });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > HOMEWORK_MAX_FILE_BYTES) {
      setError(`${file.name} is larger than 10 MB`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadHomeworkFile(`${base}/files`, file);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to upload file");
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(fileId: string) {
    try {
      await apiFetch(`${base}/files/${fileId}`, { method: "DELETE", auth: true });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove file");
    }
  }

  return (
    <div className={cn("space-y-2 rounded-lg border border-border px-3 py-2.5", existing && "bg-card-inset")}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted">{existing ? "Your submission" : "Submit work online"}</span>
        {existing && <Badge variant={existing.isLate ? "warning" : "info"}>{existing.isLate ? "Submitted late" : "Submitted"}</Badge>}
      </div>
      <Textarea rows={3} placeholder="Type an answer or a note for the teacher (optional)" value={text} onChange={(e) => setText(e.target.value)} />
      <FileList files={existing?.files ?? []} onRemove={removeFile} />
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={saveText}>
          {existing ? "Update submission" : "Submit"}
        </Button>
        {(existing?.files.length ?? 0) < 5 && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={HOMEWORK_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" /> Upload file
            </Button>
          </>
        )}
        {saved && <span className="text-[11px] text-success">Saved</span>}
      </div>
      <p className="text-[11px] text-muted">You can change this until the teacher marks it. PDF, Word or image, up to 10 MB.</p>
    </div>
  );
}
