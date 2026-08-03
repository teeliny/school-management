"use client";

import { useCallback, useEffect, useState } from "react";
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
interface ClassLevelOption {
  id: string;
  name: string;
}
interface ReportWindowItem {
  id: string;
  inputOpensAt: string;
  inputClosesAt: string;
  status: WindowStatus;
}

export function ReportWindowManager({
  terms,
  classLevels,
}: {
  terms: TermOption[];
  classLevels: ClassLevelOption[];
}) {
  const [termId, setTermId] = useState("");
  const [classLevelId, setClassLevelId] = useState("");
  const [windows, setWindows] = useState<ReportWindowItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [inputOpensAt, setInputOpensAt] = useState("");
  const [inputClosesAt, setInputClosesAt] = useState("");

  const load = useCallback(() => {
    if (!termId || !classLevelId) {
      setWindows(null);
      return;
    }
    apiFetch<ReportWindowItem[]>(`/report-windows?termId=${termId}&classLevelId=${classLevelId}`, { auth: true })
      .then(setWindows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load report windows"));
  }, [termId, classLevelId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/report-windows", {
        method: "POST",
        auth: true,
        body: { termId, classLevelId, inputOpensAt, inputClosesAt },
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
          <Label htmlFor="rw-class-level">Class level</Label>
          <Select value={classLevelId} onValueChange={setClassLevelId}>
            <SelectTrigger id="rw-class-level" className="mt-1">
              <SelectValue placeholder="Select class level" />
            </SelectTrigger>
            <SelectContent>
              {classLevels.map((level) => (
                <SelectItem key={level.id} value={level.id}>
                  {level.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {windows && (
        <>
          <div className="space-y-1.5">
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
            {windows.length === 0 && <p className="text-sm text-muted">No report window for this term/class level yet.</p>}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-3">
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
      {!windows && <p className="text-sm text-muted">Select a term and class level to manage its report window.</p>}
    </div>
  );
}
