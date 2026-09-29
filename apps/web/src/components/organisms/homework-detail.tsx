"use client";

import { useCallback, useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatDueDate, formatFileSize, maxScoreOf, type HomeworkDetail as HomeworkDetailData, type HomeworkStatus } from "../../lib/homework";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Card, CardHeader } from "../molecules/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";
import { HomeworkForm } from "./homework-form";
import { HomeworkMarkingTable } from "./homework-marking-table";
import { HomeworkTransferDialog } from "./homework-transfer-dialog";

export const HOMEWORK_STATUS_VARIANT: Record<HomeworkStatus, BadgeVariant> = {
  DRAFT: "muted",
  PUBLISHED: "success",
  CLOSED: "warning",
};

/**
 * Staff-side view of one homework: details, lifecycle actions (publish/
 * close/reopen/edit/delete), marking, and the optional CA transfer. Also
 * used read-only by class teachers and Principal/Headteacher (the API's
 * `viewerCanManage` hides every action for them).
 */
export function HomeworkDetail({ homeworkId, onChanged, onDeleted }: { homeworkId: string; onChanged: () => void; onDeleted: () => void }) {
  const [homework, setHomework] = useState<HomeworkDetailData | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<HomeworkDetailData>(`/homework/${homeworkId}`, { auth: true })
      .then((h) => {
        setHomework(h);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load homework"));
  }, [homeworkId]);

  useEffect(() => {
    setHomework(null);
    setEditing(false);
    load();
  }, [load]);

  async function action(path: "publish" | "close") {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/homework/${homeworkId}/${path}`, { method: "POST", auth: true });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await apiFetch(`/homework/${homeworkId}`, { method: "DELETE", auth: true });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete homework");
    }
  }

  if (!homework) {
    return <Card>{error ? <p className="text-sm text-danger">{error}</p> : <p className="text-sm text-muted">Loading…</p>}</Card>;
  }

  const max = maxScoreOf(homework);
  const canDelete = homework.roster.every((r) => !r.mark && !r.submission);
  const hasStaleTransfer = homework.roster.some((r) => r.mark?.changedSinceTransfer);

  if (editing) {
    return (
      <Card>
        <CardHeader title="Edit homework" />
        <HomeworkForm
          target={{ subjectId: homework.subjectId, classArmId: homework.classArmId, termId: homework.termId, classLevelCategory: homework.classArm.classLevel.category }}
          existing={homework}
          onSaved={() => {
            setEditing(false);
            load();
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={homework.title}
          sub={`${homework.subject.name} · ${homework.classArm.classLevel.name} ${homework.classArm.name} · ${homework.term.name}`}
          action={<Badge variant={HOMEWORK_STATUS_VARIANT[homework.status]}>{homework.status}</Badge>}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Due</dt>
            <dd className="font-mono">{formatDueDate(homework.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Max score</dt>
            <dd className="font-mono">{max ?? "Not scored"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Online submission</dt>
            <dd>{homework.allowOnlineSubmission ? "Accepted" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Counts toward</dt>
            <dd>{homework.caComponent ? homework.caComponent.name : "Not graded (practice only)"}</dd>
          </div>
        </dl>
        <p className="mt-3 whitespace-pre-wrap text-[13px]">{homework.instructions}</p>
        {homework.attachments.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12.5px]">
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

        {homework.viewerCanManage && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
            {homework.status === "DRAFT" && (
              <Button type="button" size="sm" disabled={busy} onClick={() => action("publish")}>
                Publish to students &amp; parents
              </Button>
            )}
            {homework.status === "PUBLISHED" && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => action("close")}>
                Close
              </Button>
            )}
            {homework.status === "CLOSED" && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => action("publish")}>
                Reopen
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {homework.caComponent && homework.status !== "DRAFT" && <HomeworkTransferDialog homework={homework} onTransferred={load} />}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="text-danger">
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle className="font-display text-[15.5px] font-semibold">Delete this homework?</AlertDialogTitle>
                  <AlertDialogDescription className="mt-1 text-[12.5px] text-muted">
                    &ldquo;{homework.title}&rdquo; and its attachments will be removed. This can&apos;t be undone.
                  </AlertDialogDescription>
                  <div className="mt-4 flex justify-end gap-2">
                    <AlertDialogCancel asChild>
                      <Button variant="outline" size="sm">
                        Cancel
                      </Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button size="sm" onClick={remove}>
                        Delete
                      </Button>
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
        {homework.caComponent && homework.caTransferredAt && (
          <p className="mt-2 text-[11.5px] text-muted">
            Last transferred to {homework.caComponent.name} on {new Date(homework.caTransferredAt).toLocaleString()}.
            {hasStaleTransfer && <span className="text-warning"> Some marks changed since — transfer again to update the gradebook.</span>}
          </p>
        )}
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      </Card>

      <Card>
        <CardHeader title="Marking" sub={max !== null ? `Scores out of ${max}` : "Marked with feedback only"} />
        <HomeworkMarkingTable
          homework={homework}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      </Card>
    </div>
  );
}
