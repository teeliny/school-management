"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import {
  formatFileSize,
  HOMEWORK_FILE_ACCEPT,
  HOMEWORK_MAX_FILE_BYTES,
  maxScoreOf,
  uploadHomeworkFile,
  type HomeworkDetail,
  type HomeworkSummary,
} from "../../lib/homework";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface CaComponentOption {
  id: string;
  name: string;
  type: string;
  maxScore: number;
  status: string;
}

const NO_CA = "none";

/**
 * Create or edit one homework (PRD §3.6a). Online submission defaults to
 * off; the optional CA link only offers CA-type components for the same
 * term + class group (the API re-checks, plus "one homework per CA per
 * subject+class").
 */
export function HomeworkForm({
  target,
  existing,
  onSaved,
  onCancel,
}: {
  // Where a new homework goes — ignored when editing `existing`.
  target: { subjectId: string; classArmId: string; termId: string; classLevelCategory: string };
  existing?: HomeworkDetail;
  onSaved: (homework: HomeworkSummary) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [dueDate, setDueDate] = useState(existing ? existing.dueDate.slice(0, 10) : "");
  const [maxScore, setMaxScore] = useState(existing && maxScoreOf(existing) !== null ? String(maxScoreOf(existing)) : "");
  const [allowOnlineSubmission, setAllowOnlineSubmission] = useState(existing?.allowOnlineSubmission ?? false);
  const [caComponentId, setCaComponentId] = useState(existing?.caComponentId ?? NO_CA);
  const [caOptions, setCaOptions] = useState<CaComponentOption[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState(existing?.attachments ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const termId = existing?.termId ?? target.termId;
  const classLevelCategory = existing?.classArm.classLevel.category ?? target.classLevelCategory;
  const hasMarks = existing ? existing.roster.some((r) => r.mark !== null) : false;

  useEffect(() => {
    if (!termId || !classLevelCategory) return;
    apiFetch<CaComponentOption[]>(`/assessment-components?termId=${termId}&classLevelCategory=${classLevelCategory}`, { auth: true })
      .then((components) => setCaOptions(components.filter((c) => c.type === "CA")))
      .catch(() => setCaOptions([]));
  }, [termId, classLevelCategory]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const tooBig = Array.from(files).find((f) => f.size > HOMEWORK_MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 10 MB`);
      return;
    }
    setError(null);
    setPendingFiles((prev) => [...prev, ...Array.from(files)].slice(0, 5 - attachments.length));
  }

  async function removeAttachment(attachmentId: string) {
    if (!existing) return;
    try {
      await apiFetch(`/homework/${existing.id}/attachments/${attachmentId}`, { method: "DELETE", auth: true });
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove attachment");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedMax = maxScore.trim() === "" ? null : Number(maxScore);
    if (parsedMax !== null && (Number.isNaN(parsedMax) || parsedMax < 1)) {
      setError("Max score must be at least 1");
      return;
    }
    const ca = caComponentId === NO_CA ? null : caComponentId;
    if (ca && parsedMax === null) {
      setError("Set a max score to count this homework toward a CA");
      return;
    }

    setSaving(true);
    try {
      const body = { title, instructions, dueDate, maxScore: parsedMax, allowOnlineSubmission, caComponentId: ca };
      const saved = existing
        ? await apiFetch<HomeworkSummary>(`/homework/${existing.id}`, { method: "PATCH", auth: true, body })
        : await apiFetch<HomeworkSummary>("/homework", {
            method: "POST",
            auth: true,
            body: { ...body, subjectId: target.subjectId, classArmId: target.classArmId, termId: target.termId },
          });
      for (const file of pendingFiles) {
        await uploadHomeworkFile(`/homework/${saved.id}/attachments`, file);
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save homework");
    } finally {
      setSaving(false);
    }
  }

  const selectedCa = caOptions.find((c) => c.id === caComponentId);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="hw-title">Title</Label>
        <Input id="hw-title" className="mt-1" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="hw-instructions">Instructions</Label>
        <Textarea
          id="hw-instructions"
          className="mt-1 max-h-72"
          rows={5}
          value={instructions}
          required
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="hw-due">Due date</Label>
          <Input id="hw-due" type="date" className="mt-1 font-mono" value={dueDate} required onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="hw-max">Max score (optional)</Label>
          <Input
            id="hw-max"
            type="number"
            min={1}
            step="any"
            className="mt-1 font-mono"
            value={maxScore}
            disabled={hasMarks}
            placeholder="Leave empty to mark without a score"
            onChange={(e) => setMaxScore(e.target.value)}
          />
          {hasMarks && <p className="mt-1 text-[11px] text-muted">Locked — students have already been marked.</p>}
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-[12.5px]">
        <Checkbox
          className="mt-0.5"
          checked={allowOnlineSubmission}
          onCheckedChange={(checked) => setAllowOnlineSubmission(checked === true)}
        />
        <span>
          Accept online submissions
          <span className="block text-[11.5px] text-muted">Students or parents can upload completed work before you mark it.</span>
        </span>
      </label>

      <div>
        <Label htmlFor="hw-ca">Count toward a CA (optional)</Label>
        <Select value={caComponentId} onValueChange={setCaComponentId}>
          <SelectTrigger id="hw-ca" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CA}>Don&apos;t count toward a CA</SelectItem>
            {caOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} (out of {Number(c.maxScore)}, {c.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11.5px] text-muted">
          {selectedCa
            ? `After marking, use "Transfer to gradebook" to copy scores into ${selectedCa.name}, scaled to ${Number(selectedCa.maxScore)}. Nothing reaches the gradebook until you do.`
            : "Unlinked homework never affects term results."}
        </p>
      </div>

      <div>
        <Label>Attachments (optional)</Label>
        <ul className="mt-1 space-y-1 text-[12.5px]">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 text-muted" />
              <a href={a.url} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
                {a.fileName}
              </a>
              <span className="font-mono text-[11px] text-muted">{formatFileSize(a.sizeBytes)}</span>
              <button type="button" aria-label={`Remove ${a.fileName}`} onClick={() => removeAttachment(a.id)} className="text-muted hover:text-danger">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {pendingFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 text-muted" />
              <span>{f.name}</span>
              <span className="font-mono text-[11px] text-muted">{formatFileSize(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {attachments.length + pendingFiles.length < 5 && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={HOMEWORK_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => fileInput.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" /> Add file
            </Button>
            <p className="mt-1 text-[11px] text-muted">PDF, Word or image, up to 10 MB each, 5 files max.</p>
          </>
        )}
      </div>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Save as draft"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
