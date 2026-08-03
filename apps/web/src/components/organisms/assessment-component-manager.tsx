"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type ComponentType = "CA" | "MID_TERM" | "EXAM";
type ComponentStatus = "DRAFT" | "OPEN" | "CLOSED" | "PUBLISHED";
const TYPES: ComponentType[] = ["CA", "MID_TERM", "EXAM"];

const STATUS_VARIANT: Record<ComponentStatus, BadgeVariant> = {
  DRAFT: "muted",
  OPEN: "success",
  CLOSED: "warning",
  PUBLISHED: "info",
};

interface TermOption {
  id: string;
  name: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
}
interface AssessmentComponentItem {
  id: string;
  type: ComponentType;
  name: string;
  sequence: number;
  maxScore: number;
  inputOpensAt: string;
  inputClosesAt: string;
  publishAt: string;
  status: ComponentStatus;
}

export function AssessmentComponentManager({
  terms,
  classLevels,
}: {
  terms: TermOption[];
  classLevels: ClassLevelOption[];
}) {
  const [termId, setTermId] = useState("");
  const [classLevelId, setClassLevelId] = useState("");
  const [components, setComponents] = useState<AssessmentComponentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [type, setType] = useState<ComponentType>("CA");
  const [name, setName] = useState("");
  const [sequence, setSequence] = useState("1");
  const [maxScore, setMaxScore] = useState("");
  const [inputOpensAt, setInputOpensAt] = useState("");
  const [inputClosesAt, setInputClosesAt] = useState("");
  const [publishAt, setPublishAt] = useState("");

  const load = useCallback(() => {
    if (!termId || !classLevelId) {
      setComponents(null);
      return;
    }
    apiFetch<AssessmentComponentItem[]>(`/assessment-components?termId=${termId}&classLevelId=${classLevelId}`, {
      auth: true,
    })
      .then(setComponents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load assessment components"));
  }, [termId, classLevelId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/assessment-components", {
        method: "POST",
        auth: true,
        body: {
          termId,
          classLevelId,
          type,
          name,
          sequence: Number(sequence),
          maxScore: Number(maxScore),
          inputOpensAt,
          inputClosesAt,
          publishAt,
        },
      });
      setName("");
      setMaxScore("");
      setInputOpensAt("");
      setInputClosesAt("");
      setPublishAt("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, action: "force-open" | "force-close" | "force-publish") {
    setError(null);
    try {
      await apiFetch(`/assessment-components/${id}/${action}`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action.replace("force-", "")} component`);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ac-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="ac-term" className="mt-1">
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
          <Label htmlFor="ac-class-level">Class level</Label>
          <Select value={classLevelId} onValueChange={setClassLevelId}>
            <SelectTrigger id="ac-class-level" className="mt-1">
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

      {components && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Name</th>
                  <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Type</th>
                  <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Seq</th>
                  <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Max</th>
                  <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Status</th>
                  <th className="py-2 text-[10px] font-medium uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody>
                {components.map((component) => (
                  <tr key={component.id} className="border-b border-border/60 last:border-none">
                    <td className="py-2.5 pr-3 font-medium">{component.name}</td>
                    <td className="py-2.5 pr-3">{component.type}</td>
                    <td className="py-2.5 pr-3 font-mono text-muted">{component.sequence}</td>
                    <td className="py-2.5 pr-3 font-mono text-muted">{component.maxScore}</td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={STATUS_VARIANT[component.status]}>{component.status}</Badge>
                    </td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => transition(component.id, "force-open")}>
                          Open
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => transition(component.id, "force-close")}>
                          Close
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => transition(component.id, "force-publish")}>
                          Publish
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {components.length === 0 && <p className="mt-2 text-sm text-muted">No assessment components yet.</p>}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ac-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ComponentType)}>
                <SelectTrigger id="ac-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormField label="Name (e.g. 1st CA)" id="ac-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <FormField label="Sequence" id="ac-sequence" type="number" required value={sequence} onChange={(e) => setSequence(e.target.value)} />
            <FormField label="Max score" id="ac-max-score" type="number" required value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            <FormField
              label="Opens at"
              id="ac-opens-at"
              type="datetime-local"
              required
              value={inputOpensAt}
              onChange={(e) => setInputOpensAt(e.target.value)}
            />
            <FormField
              label="Closes at"
              id="ac-closes-at"
              type="datetime-local"
              required
              value={inputClosesAt}
              onChange={(e) => setInputClosesAt(e.target.value)}
            />
            <FormField
              label="Publishes at"
              id="ac-publish-at"
              type="datetime-local"
              required
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
            />
            <Button type="submit" disabled={submitting || !termId || !classLevelId} className="col-span-3">
              {submitting ? "Creating…" : "Create component"}
            </Button>
          </form>
        </>
      )}
      {!components && <p className="text-sm text-muted">Select a term and class level to manage components.</p>}
    </div>
  );
}
