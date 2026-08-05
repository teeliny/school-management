"use client";

import { useCallback, useEffect, useState } from "react";
import { CLASS_LEVEL_CATEGORIES, type ClassLevelCategory } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type WindowStatus = "DRAFT" | "OPEN" | "CLOSED";
const STATUS_VARIANT: Record<WindowStatus, BadgeVariant> = {
  DRAFT: "muted",
  OPEN: "success",
  CLOSED: "warning",
};

interface TermOption {
  id: string;
  name: string;
}
interface ReportWindowItem {
  id: string;
  termId: string;
  classLevelCategory: ClassLevelCategory;
  inputOpensAt: string;
  inputClosesAt: string;
  status: WindowStatus;
}

function toDatetimeLocalValue(iso: string): string {
  return iso.slice(0, 16);
}

export function ReportWindowManager({ terms }: { terms: TermOption[] }) {
  const [termId, setTermId] = useState("");
  const [classLevelCategory, setClassLevelCategory] = useState<ClassLevelCategory | "">("");
  const [windows, setWindows] = useState<ReportWindowItem[] | null>(null);
  const [existingWindows, setExistingWindows] = useState<ReportWindowItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [inputOpensAt, setInputOpensAt] = useState("");
  const [inputClosesAt, setInputClosesAt] = useState("");

  const load = useCallback(() => {
    if (!termId || !classLevelCategory) {
      setWindows(null);
      return;
    }
    apiFetch<ReportWindowItem[]>(`/report-windows?termId=${termId}&classLevelCategory=${classLevelCategory}`, {
      auth: true,
    })
      .then(setWindows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load report windows"));
  }, [termId, classLevelCategory]);

  useEffect(() => {
    load();
  }, [load]);

  // Every report window ever configured, across every class group/term/
  // session — powers the "copy dates from existing" picker below,
  // independent of which class group/term is currently selected.
  useEffect(() => {
    apiFetch<ReportWindowItem[]>("/report-windows", { auth: true })
      .then(setExistingWindows)
      .catch(() => setExistingWindows([]));
  }, []);

  function applyExisting(id: string) {
    const existing = existingWindows.find((w) => w.id === id);
    if (!existing) return;
    setInputOpensAt(toDatetimeLocalValue(existing.inputOpensAt));
    setInputClosesAt(toDatetimeLocalValue(existing.inputClosesAt));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/report-windows", {
        method: "POST",
        auth: true,
        body: { termId, classLevelCategory, inputOpensAt, inputClosesAt },
      });
      setInputOpensAt("");
      setInputClosesAt("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, action: "force-open" | "force-close") {
    setError(null);
    try {
      await apiFetch(`/report-windows/${id}/${action}`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action.replace("force-", "")} window`);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rw-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="rw-term" className="mt-1">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="rw-class-group">Class group</Label>
          <Select value={classLevelCategory} onValueChange={(v) => setClassLevelCategory(v as ClassLevelCategory)}>
            <SelectTrigger id="rw-class-group" className="mt-1">
              <SelectValue placeholder="Select class group" />
            </SelectTrigger>
            <SelectContent>
              {CLASS_LEVEL_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {windows && (
        <>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {windows.map((window) => (
              <div key={window.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                <span className="font-mono text-muted">
                  {new Date(window.inputOpensAt).toLocaleString()} → {new Date(window.inputClosesAt).toLocaleString()}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge variant={STATUS_VARIANT[window.status]}>{window.status}</Badge>
                  <Button type="button" variant="outline" size="sm" onClick={() => transition(window.id, "force-open")}>
                    Open
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => transition(window.id, "force-close")}>
                    Close
                  </Button>
                </div>
              </div>
            ))}
            {windows.length === 0 && <p className="text-sm text-muted">No report window for this term/class group yet.</p>}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-3">
            {existingWindows.length > 0 && (
              <div className="col-span-3">
                <Label htmlFor="rw-copy-from">Copy dates from existing (any class group, any term)</Label>
                <Select value="" onValueChange={applyExisting}>
                  <SelectTrigger id="rw-copy-from" className="mt-1">
                    <SelectValue placeholder="Select a previous report window…" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingWindows.map((existing) => (
                      <SelectItem key={existing.id} value={existing.id}>
                        {existing.classLevelCategory} · {terms.find((t) => t.id === existing.termId)?.name ?? existing.termId} —{" "}
                        {new Date(existing.inputOpensAt).toLocaleDateString()} →{" "}
                        {new Date(existing.inputClosesAt).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <FormField
              label="Opens at"
              id="rw-opens-at"
              type="datetime-local"
              required
              value={inputOpensAt}
              onChange={(e) => setInputOpensAt(e.target.value)}
            />
            <FormField
              label="Closes at"
              id="rw-closes-at"
              type="datetime-local"
              required
              value={inputClosesAt}
              onChange={(e) => setInputClosesAt(e.target.value)}
            />
            <Button type="submit" disabled={submitting} className="self-end">
              {submitting ? "Creating…" : "Create window"}
            </Button>
          </form>
        </>
      )}
      {!windows && <p className="text-sm text-muted">Select a term and class group to manage its report window.</p>}
    </div>
  );
}
