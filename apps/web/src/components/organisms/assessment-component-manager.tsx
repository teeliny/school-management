"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { CLASS_LEVEL_CATEGORIES, type ClassLevelCategory } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { toDatetimeLocalInputValue, fromDatetimeLocalInputValue } from "../../lib/datetime";
import { Button } from "../atoms/button";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { EmptyState } from "../molecules/empty-state";
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
interface AssessmentComponentItem {
  id: string;
  type: ComponentType;
  name: string;
  sequence: number;
  maxScore: number;
  // Null on a freshly carried-forward component until Admin sets it for
  // this term (TermService.create's carry-forward never copies dates).
  inputOpensAt: string | null;
  inputClosesAt: string | null;
  publishAt: string | null;
  status: ComponentStatus;
}

// Raw shape returned by GET /assessment-components with no filters — every
// component ever defined, any class group/term/session.
interface ExistingComponentRow extends AssessmentComponentItem {
  termId: string;
  classLevelCategory: ClassLevelCategory;
}

interface ExistingStructure {
  key: string;
  termId: string;
  classLevelCategory: ClassLevelCategory;
  components: ExistingComponentRow[];
}

// A full "structure" (the complete related set — 1st CA, 2nd CA, Mid-Term,
// Exam, etc.) is everything sharing one (termId, classLevelCategory) — that's
// the natural unit to copy wholesale, dates included, onto a new term/group.
function groupIntoStructures(items: ExistingComponentRow[]): ExistingStructure[] {
  const groups = new Map<string, ExistingStructure>();
  for (const item of items) {
    const key = `${item.termId}|${item.classLevelCategory}`;
    const group = groups.get(key) ?? { key, termId: item.termId, classLevelCategory: item.classLevelCategory, components: [] };
    group.components.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function AssessmentComponentManager({ terms }: { terms: TermOption[] }) {
  const [termId, setTermId] = useState("");
  const [classLevelCategory, setClassLevelCategory] = useState<ClassLevelCategory | "">("");
  const [components, setComponents] = useState<AssessmentComponentItem[] | null>(null);
  const [existingStructures, setExistingStructures] = useState<ExistingStructure[]>([]);
  const [copyFromKey, setCopyFromKey] = useState("");
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [type, setType] = useState<ComponentType>("CA");
  const [name, setName] = useState("");
  const [sequence, setSequence] = useState("1");
  const [maxScore, setMaxScore] = useState("");
  const [inputOpensAt, setInputOpensAt] = useState("");
  const [inputClosesAt, setInputClosesAt] = useState("");
  const [publishAt, setPublishAt] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!termId || !classLevelCategory) {
      setComponents(null);
      return;
    }
    apiFetch<AssessmentComponentItem[]>(
      `/assessment-components?termId=${termId}&classLevelCategory=${classLevelCategory}`,
      { auth: true },
    )
      .then(setComponents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load assessment components"));
  }, [termId, classLevelCategory]);

  useEffect(() => {
    load();
  }, [load]);

  // Every full structure (a term+class group's complete related set of
  // components) ever defined, across every class group/term/session —
  // powers the "copy an existing structure" action below, independent of
  // which class group/term is currently selected.
  const loadExistingStructures = useCallback(() => {
    apiFetch<ExistingComponentRow[]>("/assessment-components", { auth: true })
      .then((items) => setExistingStructures(groupIntoStructures(items)))
      .catch(() => setExistingStructures([]));
  }, []);

  useEffect(() => {
    loadExistingStructures();
  }, [loadExistingStructures]);

  const copyableStructures = existingStructures.filter(
    (s) => !(s.termId === termId && s.classLevelCategory === classLevelCategory),
  );

  async function copyStructure() {
    const structure = copyableStructures.find((s) => s.key === copyFromKey);
    if (!structure || !termId || !classLevelCategory) return;
    setError(null);
    setCopying(true);
    const failures: string[] = [];
    try {
      for (const source of structure.components) {
        try {
          await apiFetch("/assessment-components", {
            method: "POST",
            auth: true,
            body: {
              termId,
              classLevelCategory,
              type: source.type,
              name: source.name,
              sequence: source.sequence,
              maxScore: Number(source.maxScore),
              inputOpensAt: source.inputOpensAt,
              inputClosesAt: source.inputClosesAt,
              publishAt: source.publishAt,
            },
          });
        } catch (err) {
          failures.push(`${source.name}: ${err instanceof ApiError ? err.message : "failed"}`);
        }
      }
      if (failures.length > 0) {
        setError(`Some components couldn't be copied — ${failures.join("; ")}`);
      }
      setCopyFromKey("");
      load();
      loadExistingStructures();
    } finally {
      setCopying(false);
    }
  }

  function resetForm() {
    setType("CA");
    setName("");
    setSequence("1");
    setMaxScore("");
    setInputOpensAt("");
    setInputClosesAt("");
    setPublishAt("");
  }

  function startEdit(component: AssessmentComponentItem) {
    setEditingId(component.id);
    setType(component.type);
    setName(component.name);
    setSequence(String(component.sequence));
    setMaxScore(String(component.maxScore));
    setInputOpensAt(toDatetimeLocalInputValue(component.inputOpensAt));
    setInputClosesAt(toDatetimeLocalInputValue(component.inputClosesAt));
    setPublishAt(toDatetimeLocalInputValue(component.publishAt));
  }

  function cancelEdit() {
    setEditingId(null);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        termId,
        classLevelCategory,
        type,
        name,
        sequence: Number(sequence),
        maxScore: Number(maxScore),
        inputOpensAt: fromDatetimeLocalInputValue(inputOpensAt),
        inputClosesAt: fromDatetimeLocalInputValue(inputClosesAt),
        publishAt: fromDatetimeLocalInputValue(publishAt),
      };

      if (editingId) {
        await apiFetch(`/assessment-components/${editingId}`, { method: "PATCH", auth: true, body });
        setEditingId(null);
      } else {
        await apiFetch("/assessment-components", { method: "POST", auth: true, body });
      }
      resetForm();
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
          <Label htmlFor="ac-class-group">Class group</Label>
          <Select value={classLevelCategory} onValueChange={(v) => setClassLevelCategory(v as ClassLevelCategory)}>
            <SelectTrigger id="ac-class-group" className="mt-1">
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

      {components && (
        <>
          <div className="max-h-[420px] overflow-auto">
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
                        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(component)}>
                          Edit
                        </Button>
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
            {components.length === 0 && <EmptyState icon={ClipboardList} title="No assessment components yet" className="py-6" />}
          </div>

          {copyableStructures.length > 0 && (
            <div className="flex items-end gap-2 rounded-lg border border-border p-2.5">
              <div className="flex-1">
                <Label htmlFor="ac-copy-from">Copy a full structure from existing (any class group, any term)</Label>
                <Select value={copyFromKey} onValueChange={setCopyFromKey}>
                  <SelectTrigger id="ac-copy-from" className="mt-1">
                    <SelectValue placeholder="Select a previous term/class group's structure…" />
                  </SelectTrigger>
                  <SelectContent>
                    {copyableStructures.map((structure) => (
                      <SelectItem key={structure.key} value={structure.key}>
                        {structure.classLevelCategory} · {terms.find((t) => t.id === structure.termId)?.name ?? structure.termId} (
                        {structure.components.length} component{structure.components.length === 1 ? "" : "s"}:{" "}
                        {structure.components.map((c) => c.name).join(", ")})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" disabled={!copyFromKey || copying} onClick={copyStructure}>
                {copying ? "Copying…" : "Copy structure"}
              </Button>
            </div>
          )}

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
            <div className="col-span-3 flex gap-2">
              <Button type="submit" disabled={submitting || !termId || !classLevelCategory} className="w-full">
                {submitting ? "Saving…" : editingId ? "Save changes" : "Create component"}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </>
      )}
      {!components && <p className="text-sm text-muted">Select a term and class group to manage components.</p>}
    </div>
  );
}
