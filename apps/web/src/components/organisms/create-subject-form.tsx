"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
import { Badge } from "../atoms/badge";
import { Label } from "../atoms/label";
import { Input } from "../atoms/input";
import { cn } from "../../lib/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";
import { CLASS_GROUPS, TYPE_LABELS, type ClassLevelCategory, type SubjectType } from "../../lib/subject-applicability";
import type { ClassSubjectSummary } from "./subject-list";

interface DepartmentOption {
  id: string;
  name: string;
}

export interface EditableSubject {
  id: string;
  name: string;
  code: string;
  requiresCalculation: boolean;
  isGroup: boolean;
  // Current class-group assignments (SubjectList passes these through from
  // GET /subjects) — used to pre-fill the class-group section below when
  // editing, so add/change/remove all happen from this one form.
  classSubjects?: ClassSubjectSummary[];
}

interface ChildRow {
  name: string;
  code: string;
  weight: string;
}

// One row of the multi-select class-group section below — type/departmentId
// are per-group because the same subject can apply differently per group
// (e.g. GENERAL for JSS, DEPARTMENT-restricted for SSS). `classSubjectId` is
// only set once the row corresponds to an already-persisted ClassSubject
// (edit mode) — its absence is what tells handleSubmit to POST a new one
// rather than PATCH/leave alone.
interface GroupAssignment {
  classLevelCategory: ClassLevelCategory;
  type: SubjectType;
  departmentId: string;
  classSubjectId?: string;
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

function toGroupAssignments(classSubjects: ClassSubjectSummary[] | undefined): GroupAssignment[] {
  return (classSubjects ?? []).map((cs) => ({
    classLevelCategory: cs.classLevelCategory,
    type: cs.type,
    departmentId: cs.departmentId ?? "",
    classSubjectId: cs.id,
  }));
}

// PRD §3.3: a grouped subject (e.g. Basic Science and Technology) is one
// parent with N independently-scored children, each with an aggregation
// weight — created via POST /subjects/groups in a single transaction.
// When `editingSubject` is set (SubjectList's "Edit" button), this form
// switches into edit mode: fields are pre-filled (including its class-group
// assignments below), the grouped-subject creation UI is hidden (editing
// only touches the plain Subject fields — UpdateSubjectDto has no group
// semantics), and submit PATCHes instead.
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
  const [requiresCalculation, setRequiresCalculation] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [children, setChildren] = useState<ChildRow[]>([emptyChild(), emptyChild()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Which class group(s) this subject belongs to (PRD §3.3), each with its
  // own type/department — type/departmentId are set here rather than on the
  // Subject itself, since applicability can differ per class group (see
  // ClassSubject). Not session-scoped — ClassSubject persists on its own
  // (schema.prisma). `initialGroupAssignments` is the snapshot handleSubmit
  // diffs against in edit mode to know what to POST/PATCH/DELETE.
  const [groupAssignments, setGroupAssignments] = useState<GroupAssignment[]>([]);
  const [initialGroupAssignments, setInitialGroupAssignments] = useState<GroupAssignment[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

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
      setRequiresCalculation(editingSubject.requiresCalculation);
      setIsGroup(false);
      const existing = toGroupAssignments(editingSubject.classSubjects);
      setGroupAssignments(existing);
      setInitialGroupAssignments(existing);

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

  function toggleGroup(group: ClassLevelCategory, checked: boolean) {
    setGroupAssignments((prev) => {
      if (checked) {
        if (prev.some((g) => g.classLevelCategory === group)) return prev;
        const existing = initialGroupAssignments.find((g) => g.classLevelCategory === group);
        return [...prev, existing ?? { classLevelCategory: group, type: "GENERAL", departmentId: "" }];
      }
      return prev.filter((g) => g.classLevelCategory !== group);
    });
  }

  // Reconciles the MultiSelect's full selected-values array against the
  // current rows: newly-checked groups get a fresh (or previously-existing,
  // if re-checking) row, unchecked ones drop out — same shape toggleGroup
  // produces, just applied to a whole batch of checkbox toggles at once.
  function setGroupsFromValues(values: string[]) {
    setGroupAssignments((prev) => [
      ...prev.filter((g) => values.includes(g.classLevelCategory)),
      ...values
        .filter((v) => !prev.some((g) => g.classLevelCategory === v))
        .map((v) => {
          const group = v as ClassLevelCategory;
          const existing = initialGroupAssignments.find((g) => g.classLevelCategory === group);
          return existing ?? { classLevelCategory: group, type: "GENERAL" as SubjectType, departmentId: "" };
        }),
    ]);
  }

  function updateGroupAssignment(group: ClassLevelCategory, patch: Partial<GroupAssignment>) {
    setGroupAssignments((prev) => prev.map((g) => (g.classLevelCategory === group ? { ...g, ...patch } : g)));
  }

  function reset() {
    setName("");
    setCode("");
    setRequiresCalculation(false);
    setIsGroup(false);
    setChildren([emptyChild(), emptyChild()]);
    setGroupAssignments([]);
    setInitialGroupAssignments([]);
  }

  function classSubjectBody(g: GroupAssignment) {
    return { type: g.type, departmentId: g.type === "DEPARTMENT" ? g.departmentId || undefined : undefined };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      // Not editing, exactly one group picked: prefix the code with it (e.g.
      // "CRS" + JSS -> "JSS_CRS") so the catalogue's code column reads which
      // group a subject originated from at a glance. With zero or several
      // groups picked there's no single group to prefix with, so the code
      // is used as typed.
      const singleGroup = !isEditing && groupAssignments.length === 1 ? groupAssignments[0]?.classLevelCategory ?? null : null;
      const fullCode = singleGroup ? `${singleGroup}_${code}` : code;
      const base = { name, code: fullCode, requiresCalculation };

      if (editingSubject) {
        await apiFetch(`/subjects/${editingSubject.id}`, { method: "PATCH", auth: true, body: base });

        const toDelete = initialGroupAssignments.filter(
          (init) => !groupAssignments.some((g) => g.classLevelCategory === init.classLevelCategory),
        );
        const toCreate = groupAssignments.filter((g) => !g.classSubjectId);
        const toUpdate = groupAssignments.filter((g) => {
          if (!g.classSubjectId) return false;
          const init = initialGroupAssignments.find((i) => i.classLevelCategory === g.classLevelCategory);
          return init ? init.type !== g.type || init.departmentId !== g.departmentId : false;
        });

        const results = await Promise.allSettled([
          ...toDelete.map((d) => apiFetch(`/class-subjects/${d.classSubjectId}`, { method: "DELETE", auth: true })),
          ...toCreate.map((c) =>
            apiFetch("/class-subjects", {
              method: "POST",
              auth: true,
              body: { classLevelCategory: c.classLevelCategory, subjectId: editingSubject.id, ...classSubjectBody(c) },
            }),
          ),
          ...toUpdate.map((u) =>
            apiFetch(`/class-subjects/${u.classSubjectId}`, {
              method: "PATCH",
              auth: true,
              body: classSubjectBody(u),
            }),
          ),
        ]);
        const failedCount = results.filter((r) => r.status === "rejected").length;
        if (failedCount > 0) {
          setError(`${name} was saved, but ${failedCount} class-group change(s) failed — please retry.`);
        }

        onEditSaved?.();
        return;
      }

      const created = isGroup
        ? await apiFetch<{ id: string }>("/subjects/groups", {
            method: "POST",
            auth: true,
            body: {
              ...base,
              children: children.map((child) => ({ ...child, weight: Number(child.weight) })),
            },
          })
        : await apiFetch<{ id: string }>("/subjects", { method: "POST", auth: true, body: base });

      const results = await Promise.allSettled(
        groupAssignments.map((g) =>
          apiFetch("/class-subjects", {
            method: "POST",
            auth: true,
            body: { classLevelCategory: g.classLevelCategory, subjectId: created.id, ...classSubjectBody(g) },
          }),
        ),
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        setError(
          `${name} was created, but ${failedCount} class-group assignment(s) failed. Use "Assign subjects to a class" below to try again.`,
        );
      } else {
        setSuccess(`${name} was created and assigned to ${groupAssignments.map((g) => g.classLevelCategory).join(", ")}.`);
      }

      reset();
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const singleGroupForCodePrefix =
    !isEditing && groupAssignments.length === 1 ? groupAssignments[0]?.classLevelCategory ?? null : null;

  const assignmentIncomplete =
    groupAssignments.some((g) => g.type === "DEPARTMENT" && !g.departmentId) ||
    (!isEditing && groupAssignments.length === 0);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Name" id="subject-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <Label htmlFor="subject-code">Code</Label>
          <div className="mt-1 flex items-stretch">
            {singleGroupForCodePrefix && (
              <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-card-inset px-2.5 font-mono text-[13px] text-muted">
                {singleGroupForCodePrefix}_
              </span>
            )}
            <Input
              id="subject-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={cn(singleGroupForCodePrefix && "rounded-l-none")}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div>
          <Label htmlFor="subject-class-groups">Class group(s)</Label>
          <div className="mt-1">
            <MultiSelect
              id="subject-class-groups"
              value={groupAssignments.map((g) => g.classLevelCategory)}
              onValueChange={setGroupsFromValues}
              options={CLASS_GROUPS.map((group) => ({ value: group, label: group }))}
              placeholder="Select class group(s)"
            />
          </div>
        </div>

        {groupAssignments.length > 0 && (
          <div className="space-y-2">
            {groupAssignments.map((assignment) => {
              const group = assignment.classLevelCategory;
              return (
                <div key={group} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-medium">{group}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${group}`}
                      onClick={() => toggleGroup(group, false)}
                      className="text-muted hover:opacity-70"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`group-type-${group}`}>Type</Label>
                      <Select
                        value={assignment.type}
                        onValueChange={(v) => updateGroupAssignment(group, { type: v as SubjectType })}
                      >
                        <SelectTrigger id={`group-type-${group}`} className="mt-1">
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
                    {assignment.type === "DEPARTMENT" && (
                      <div>
                        <Label htmlFor={`group-department-${group}`}>Department</Label>
                        <Select
                          value={assignment.departmentId}
                          onValueChange={(v) => updateGroupAssignment(group, { departmentId: v })}
                        >
                          <SelectTrigger id={`group-department-${group}`} className="mt-1">
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
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11.5px] text-muted">
          Applicability can differ per class group — e.g. General for JSS, Department-restricted for SSS.
        </p>
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
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_90px_auto_auto]">
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

          <div className="grid grid-cols-1 items-end gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-[1fr_1fr_90px_auto]">
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
            <div key={index} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_90px_auto]">
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
        <Button type="submit" disabled={submitting || assignmentIncomplete} className="w-full">
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
