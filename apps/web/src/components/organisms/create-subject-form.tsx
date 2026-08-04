"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
import { Badge } from "../atoms/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

type SubjectType = "COMPULSORY" | "GENERAL" | "DEPARTMENT";

interface DepartmentOption {
  id: string;
  name: string;
}

export interface EditableSubject {
  id: string;
  name: string;
  code: string;
  type: SubjectType;
  departmentId?: string | null;
  requiresCalculation: boolean;
  isGroup: boolean;
}

interface ChildRow {
  name: string;
  code: string;
  weight: string;
}

// A group child fetched from GET /subjects/:id — each child is itself a
// full Subject row (own id/name/code/isActive, editable via
// PATCH /subjects/:id or disabled via PATCH /subjects/:id/disable),
// paired with its aggregation weight (PATCH /subject-group-weights/:id).
interface ExistingGroupChild {
  subjectId: string;
  weightId: string;
  name: string;
  code: string;
  weight: string;
  isActive: boolean;
}

interface SubjectDetailResponse {
  groupWeightsAsGroup: Array<{
    id: string;
    weight: number;
    childSubject: { id: string; name: string; code: string; isActive: boolean };
  }>;
}

function emptyChild(): ChildRow {
  return { name: "", code: "", weight: "" };
}

const TYPE_LABELS: Record<SubjectType, string> = {
  COMPULSORY: "Compulsory",
  GENERAL: "General (opt-in)",
  DEPARTMENT: "Department-restricted",
};

// PRD §3.3: a grouped subject (e.g. Basic Science and Technology) is one
// parent with N independently-scored children, each with an aggregation
// weight — created via POST /subjects/groups in a single transaction.
// When `editingSubject` is set (SubjectList's "Edit" button), this form
// switches into edit mode: fields are pre-filled, the grouped-subject
// creation UI is hidden (editing only touches the plain Subject fields —
// UpdateSubjectDto has no group semantics), and submit PATCHes instead.
export function CreateSubjectForm({
  editingSubject,
  onCreated,
  onEditSaved,
  onCancelEdit,
}: {
  editingSubject?: EditableSubject | null;
  onCreated?: () => void;
  onEditSaved?: () => void;
  onCancelEdit?: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<SubjectType>("COMPULSORY");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [requiresCalculation, setRequiresCalculation] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [children, setChildren] = useState<ChildRow[]>([emptyChild(), emptyChild()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [existingGroupChildren, setExistingGroupChildren] = useState<ExistingGroupChild[]>([]);
  const [savingChildId, setSavingChildId] = useState<string | null>(null);
  const [togglingChildId, setTogglingChildId] = useState<string | null>(null);
  const [newChild, setNewChild] = useState<ChildRow>(emptyChild());
  const [addingChild, setAddingChild] = useState(false);

  const isEditing = Boolean(editingSubject);

  useEffect(() => {
    apiFetch<DepartmentOption[]>("/departments", { auth: true }).then(setDepartments).catch(() => setDepartments([]));
  }, []);

  function loadGroupChildren(parentId: string) {
    return apiFetch<SubjectDetailResponse>(`/subjects/${parentId}`, { auth: true })
      .then((detail) =>
        setExistingGroupChildren(
          detail.groupWeightsAsGroup.map((gw) => ({
            subjectId: gw.childSubject.id,
            weightId: gw.id,
            name: gw.childSubject.name,
            code: gw.childSubject.code,
            weight: String(gw.weight),
            isActive: gw.childSubject.isActive,
          })),
        ),
      )
      .catch(() => setExistingGroupChildren([]));
  }

  useEffect(() => {
    setError(null);
    setSuccess(null);
    setExistingGroupChildren([]);
    setNewChild(emptyChild());
    if (editingSubject) {
      setName(editingSubject.name);
      setCode(editingSubject.code);
      setType(editingSubject.type);
      setDepartmentId(editingSubject.departmentId ?? "");
      setRequiresCalculation(editingSubject.requiresCalculation);
      setIsGroup(false);

      if (editingSubject.isGroup) {
        loadGroupChildren(editingSubject.id);
      }
    } else {
      reset();
    }
  }, [editingSubject?.id]);

  function updateExistingChild(subjectId: string, patch: Partial<ExistingGroupChild>) {
    setExistingGroupChildren((rows) => rows.map((row) => (row.subjectId === subjectId ? { ...row, ...patch } : row)));
  }

  async function saveExistingChild(child: ExistingGroupChild) {
    setError(null);
    setSavingChildId(child.subjectId);
    try {
      await Promise.all([
        apiFetch(`/subjects/${child.subjectId}`, {
          method: "PATCH",
          auth: true,
          body: { name: child.name, code: child.code },
        }),
        apiFetch(`/subject-group-weights/${child.weightId}`, {
          method: "PATCH",
          auth: true,
          body: { weight: Number(child.weight) },
        }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update child subject");
    } finally {
      setSavingChildId(null);
    }
  }

  async function toggleChildActive(child: ExistingGroupChild) {
    setError(null);
    setTogglingChildId(child.subjectId);
    try {
      await apiFetch(`/subjects/${child.subjectId}/${child.isActive ? "disable" : "enable"}`, {
        method: "PATCH",
        auth: true,
      });
      updateExistingChild(child.subjectId, { isActive: !child.isActive });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update child subject status");
    } finally {
      setTogglingChildId(null);
    }
  }

  async function addExistingGroupChild() {
    if (!editingSubject) return;
    setError(null);
    setAddingChild(true);
    try {
      await apiFetch(`/subjects/${editingSubject.id}/children`, {
        method: "POST",
        auth: true,
        body: { ...newChild, weight: Number(newChild.weight) },
      });
      setNewChild(emptyChild());
      await loadGroupChildren(editingSubject.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add child subject");
    } finally {
      setAddingChild(false);
    }
  }

  function updateChild(index: number, patch: Partial<ChildRow>) {
    setChildren((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addChild() {
    setChildren((rows) => [...rows, emptyChild()]);
  }

  function removeChild(index: number) {
    setChildren((rows) => (rows.length <= 2 ? rows : rows.filter((_, i) => i !== index)));
  }

  function reset() {
    setName("");
    setCode("");
    setType("COMPULSORY");
    setDepartmentId("");
    setRequiresCalculation(false);
    setIsGroup(false);
    setChildren([emptyChild(), emptyChild()]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const base = {
        name,
        code,
        type,
        departmentId: type === "DEPARTMENT" ? departmentId || undefined : undefined,
        requiresCalculation,
      };

      if (editingSubject) {
        await apiFetch(`/subjects/${editingSubject.id}`, { method: "PATCH", auth: true, body: base });
        onEditSaved?.();
        return;
      }

      if (isGroup) {
        await apiFetch("/subjects/groups", {
          method: "POST",
          auth: true,
          body: {
            ...base,
            children: children.map((child) => ({ ...child, weight: Number(child.weight) })),
          },
        });
      } else {
        await apiFetch("/subjects", { method: "POST", auth: true, body: base });
      }

      setSuccess(`${name} was created.`);
      reset();
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" id="subject-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField label="Code" id="subject-code" required value={code} onChange={(e) => setCode(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="subject-type">Type</Label>
          <Select value={type} onValueChange={(value) => setType(value as SubjectType)}>
            <SelectTrigger id="subject-type" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as SubjectType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {type === "DEPARTMENT" && (
          <div>
            <Label htmlFor="subject-department">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger id="subject-department" className="mt-1">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <Checkbox checked={requiresCalculation} onCheckedChange={(v) => setRequiresCalculation(v === true)} />
        Requires calculation (Phase 7 scheduling flag)
      </label>

      {isEditing && editingSubject?.isGroup && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Child subjects</h3>
          {existingGroupChildren.length === 0 && <p className="text-sm text-muted">Loading child subjects…</p>}
          {existingGroupChildren.map((child) => (
            <div key={child.subjectId} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Badge variant={child.isActive ? "success" : "danger"}>
                  {child.isActive ? "Active" : "Disabled"}
                </Badge>
              </div>
              <div className="grid grid-cols-[1fr_1fr_90px_auto_auto] items-end gap-2">
                <FormField
                  label="Name"
                  id={`existing-child-${child.subjectId}-name`}
                  value={child.name}
                  onChange={(e) => updateExistingChild(child.subjectId, { name: e.target.value })}
                />
                <FormField
                  label="Code"
                  id={`existing-child-${child.subjectId}-code`}
                  value={child.code}
                  onChange={(e) => updateExistingChild(child.subjectId, { code: e.target.value })}
                />
                <FormField
                  label="Weight"
                  id={`existing-child-${child.subjectId}-weight`}
                  type="number"
                  value={child.weight}
                  onChange={(e) => updateExistingChild(child.subjectId, { weight: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingChildId === child.subjectId}
                  onClick={() => saveExistingChild(child)}
                >
                  {savingChildId === child.subjectId ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={togglingChildId === child.subjectId}
                  onClick={() => toggleChildActive(child)}
                >
                  {child.isActive ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ))}

          <div className="grid grid-cols-[1fr_1fr_90px_auto] items-end gap-2 rounded-lg border border-dashed border-border p-3">
            <FormField
              label="Name"
              id="new-existing-child-name"
              value={newChild.name}
              onChange={(e) => setNewChild({ ...newChild, name: e.target.value })}
            />
            <FormField
              label="Code"
              id="new-existing-child-code"
              value={newChild.code}
              onChange={(e) => setNewChild({ ...newChild, code: e.target.value })}
            />
            <FormField
              label="Weight"
              id="new-existing-child-weight"
              type="number"
              value={newChild.weight}
              onChange={(e) => setNewChild({ ...newChild, weight: e.target.value })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={addingChild || !newChild.name || !newChild.code || !newChild.weight}
              onClick={addExistingGroupChild}
            >
              {addingChild ? "Adding…" : "Add child subject"}
            </Button>
          </div>
        </div>
      )}

      {!isEditing && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <Checkbox checked={isGroup} onCheckedChange={(v) => setIsGroup(v === true)} />
          Grouped subject (independently-scored children, e.g. Basic Science and Technology)
        </label>
      )}

      {!isEditing && isGroup && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Child subjects</h3>
            <Button type="button" variant="outline" size="sm" onClick={addChild}>
              Add child subject
            </Button>
          </div>

          {children.map((child, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_90px_auto] items-end gap-2 rounded-lg border border-border p-3">
              <FormField
                label="Name"
                id={`child-${index}-name`}
                required
                value={child.name}
                onChange={(e) => updateChild(index, { name: e.target.value })}
              />
              <FormField
                label="Code"
                id={`child-${index}-code`}
                required
                value={child.code}
                onChange={(e) => updateChild(index, { code: e.target.value })}
              />
              <FormField
                label="Weight"
                id={`child-${index}-weight`}
                type="number"
                required
                value={child.weight}
                onChange={(e) => updateChild(index, { weight: e.target.value })}
              />
              {children.length > 2 && (
                <Button type="button" variant="outline" size="sm" onClick={() => removeChild(index)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Saving…" : isEditing ? "Save changes" : "Create subject"}
        </Button>
        {isEditing && (
          <Button type="button" variant="outline" onClick={onCancelEdit}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
