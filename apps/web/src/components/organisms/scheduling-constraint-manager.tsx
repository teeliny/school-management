"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
import { Checkbox } from "../atoms/checkbox";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

type ScheduleScope = "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";
type ClassLevelCategoryGroup = "JSS_SSS" | "CRECHE_NURSERY_PRIMARY";
type ValueType = "boolean" | "number" | "text" | "list";

const SCOPES: ScheduleScope[] = ["CLASS_TIMETABLE", "EXAM_TIMETABLE", "INVIGILATION", "WEEKLY_DUTY"];
const SCOPE_LABEL: Record<ScheduleScope, string> = {
  CLASS_TIMETABLE: "Class Timetable",
  EXAM_TIMETABLE: "Exam Timetable",
  INVIGILATION: "Invigilation",
  WEEKLY_DUTY: "Weekly Duty",
};
const GROUP_LABEL: Record<ClassLevelCategoryGroup | "GLOBAL", string> = {
  GLOBAL: "Global",
  JSS_SSS: "JSS / SSS",
  CRECHE_NURSERY_PRIMARY: "Creche / Nursery / Primary",
};

// The worker (apps/worker/src/scheduling-solve-dispatch) only ever queries
// INVIGILATION constraints with classLevelCategoryGroup: null — the JSS/SSS
// vs. Creche/Nursery/Primary hard/soft split for that scope is derived from
// the exam's own component category, not a per-group constraint row. A
// group picked here for INVIGILATION would be silently ignored by the
// solver, so the group selector is hidden for that scope rather than
// offering a choice that does nothing.
const SCOPES_SUPPORTING_GROUP: ScheduleScope[] = ["CLASS_TIMETABLE", "EXAM_TIMETABLE", "WEEKLY_DUTY"];

interface ConstraintRow {
  id: string;
  scope: ScheduleScope;
  classLevelCategoryGroup: ClassLevelCategoryGroup | null;
  key: string;
  value: boolean | number | string | string[];
  isActive: boolean;
}

function inferValueType(value: ConstraintRow["value"]): ValueType {
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

function valueToInputText(value: ConstraintRow["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return "";
  return String(value);
}

function formatValue(value: ConstraintRow["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function SchedulingConstraintManager() {
  const [rows, setRows] = useState<ConstraintRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [scope, setScope] = useState<ScheduleScope>("CLASS_TIMETABLE");
  const [group, setGroup] = useState<ClassLevelCategoryGroup | "GLOBAL">("GLOBAL");
  const [key, setKey] = useState("");
  const [valueType, setValueType] = useState<ValueType>("text");
  const [valueText, setValueText] = useState("");
  const [valueBoolean, setValueBoolean] = useState(true);
  const [isActive, setIsActive] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<ConstraintRow[]>("/scheduling-constraints", { auth: true })
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load scheduling constraints"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setScope("CLASS_TIMETABLE");
    setGroup("GLOBAL");
    setKey("");
    setValueType("text");
    setValueText("");
    setValueBoolean(true);
    setIsActive(true);
  }

  function startEdit(row: ConstraintRow) {
    setEditingId(row.id);
    setScope(row.scope);
    setGroup(row.classLevelCategoryGroup ?? "GLOBAL");
    setKey(row.key);
    const inferred = inferValueType(row.value);
    setValueType(inferred);
    if (inferred === "boolean") setValueBoolean(row.value as boolean);
    else setValueText(valueToInputText(row.value));
    setIsActive(row.isActive);
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
      let value: boolean | number | string | string[];
      if (valueType === "boolean") value = valueBoolean;
      else if (valueType === "number") value = Number(valueText);
      else if (valueType === "list")
        value = valueText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      else value = valueText;

      const body = {
        scope,
        classLevelCategoryGroup: SCOPES_SUPPORTING_GROUP.includes(scope) && group !== "GLOBAL" ? group : undefined,
        key,
        value,
        isActive,
      };

      if (editingId) {
        await apiFetch(`/scheduling-constraints/${editingId}`, { method: "PATCH", auth: true, body });
        setEditingId(null);
      } else {
        await apiFetch("/scheduling-constraints", { method: "POST", auth: true, body });
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/scheduling-constraints/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete constraint");
    }
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[480px] space-y-4 overflow-y-auto pr-1">
        {SCOPES.map((s) => {
          const scopeRows = (rows ?? [])
            .filter((r) => r.scope === s)
            .slice()
            .sort((a, b) => {
              const groupA = a.classLevelCategoryGroup ?? "";
              const groupB = b.classLevelCategoryGroup ?? "";
              return groupA === groupB ? a.key.localeCompare(b.key) : groupA.localeCompare(groupB);
            });
          if (rows && scopeRows.length === 0) return null;
          return (
            <div key={s}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{SCOPE_LABEL[s]}</p>
              <div className="space-y-1.5">
                {scopeRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                    <span className="min-w-0">
                      <Badge variant="muted" className="mr-2 align-middle">
                        {GROUP_LABEL[row.classLevelCategoryGroup ?? "GLOBAL"]}
                      </Badge>
                      <span className="font-mono font-medium">{row.key}</span>{" "}
                      <span className="text-muted">= {formatValue(row.value)}</span>
                      {!row.isActive && (
                        <Badge variant="warning" className="ml-2 align-middle">
                          Inactive
                        </Badge>
                      )}
                    </span>
                    <div className="flex flex-none items-center gap-1.5">
                      <Button type="button" variant="outline" size="sm" onClick={() => startEdit(row)}>
                        Edit
                      </Button>
                      <AlertDialog open={deletingId === row.id} onOpenChange={(open) => setDeletingId(open ? row.id : null)}>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm">
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogTitle className="text-lg font-semibold">Delete constraint &quot;{row.key}&quot;?</AlertDialogTitle>
                          <AlertDialogDescription className="mt-2 text-sm text-muted">
                            The AI scheduler will fall back to its own default for this key on the next run. This cannot be undone.
                          </AlertDialogDescription>
                          <div className="mt-4 flex justify-end gap-2">
                            <AlertDialogCancel asChild>
                              <Button variant="outline">Cancel</Button>
                            </AlertDialogCancel>
                            <Button onClick={() => handleDelete(row.id)}>Confirm delete</Button>
                          </div>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {rows?.length === 0 && <p className="text-sm text-muted">No scheduling constraints yet.</p>}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="sc-scope">Scope</Label>
          <Select
            value={scope}
            onValueChange={(v) => {
              setScope(v as ScheduleScope);
              if (!SCOPES_SUPPORTING_GROUP.includes(v as ScheduleScope)) setGroup("GLOBAL");
            }}
          >
            <SelectTrigger id="sc-scope" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {SCOPES_SUPPORTING_GROUP.includes(scope) && (
          <div>
            <Label htmlFor="sc-group">Class level group</Label>
            <Select value={group} onValueChange={(v) => setGroup(v as ClassLevelCategoryGroup | "GLOBAL")}>
              <SelectTrigger id="sc-group" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GLOBAL">Global (applies to whole scope)</SelectItem>
                <SelectItem value="JSS_SSS">JSS / SSS</SelectItem>
                <SelectItem value="CRECHE_NURSERY_PRIMARY">Creche / Nursery / Primary</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <FormField label="Key" id="sc-key" required value={key} onChange={(e) => setKey(e.target.value)} />

        <div>
          <Label htmlFor="sc-value-type">Value type</Label>
          <Select value={valueType} onValueChange={(v) => setValueType(v as ValueType)}>
            <SelectTrigger id="sc-value-type" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="boolean">Yes / No</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="list">List (comma-separated)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {valueType === "boolean" ? (
          <div>
            <Label htmlFor="sc-value-bool">Value</Label>
            <div className="mt-1 flex h-[42px] items-center gap-2">
              <Checkbox id="sc-value-bool" checked={valueBoolean} onCheckedChange={(c) => setValueBoolean(c === true)} />
              <Label htmlFor="sc-value-bool" className="!mb-0 font-normal">
                {valueBoolean ? "Yes" : "No"}
              </Label>
            </div>
          </div>
        ) : (
          <FormField
            label={valueType === "list" ? "Value (comma-separated)" : "Value"}
            id="sc-value-text"
            type={valueType === "number" ? "number" : "text"}
            required
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
          />
        )}

        <div>
          <Label htmlFor="sc-active">Status</Label>
          <div className="mt-1 flex h-[42px] items-center gap-2">
            <Checkbox id="sc-active" checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
            <Label htmlFor="sc-active" className="!mb-0 font-normal">
              Active
            </Label>
          </div>
        </div>

        <div className="col-span-2 flex gap-2 sm:col-span-4">
          <Button type="submit" disabled={submitting || !key} className="w-full">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add constraint"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
