"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";
import { Card, CardHeader } from "../molecules/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";
import { CLASS_GROUPS, type ClassLevelCategory } from "../../lib/subject-applicability";

type SkillGroupValueType = "RATING" | "RANGE_TEXT";
const VALUE_TYPES: SkillGroupValueType[] = ["RATING", "RANGE_TEXT"];
const VALUE_TYPE_LABEL: Record<SkillGroupValueType, string> = {
  RATING: "Rating (Excellent / Very Good / Good / Fair / Poor)",
  RANGE_TEXT: 'Free text (e.g. "1-10", "a-f")',
};

interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface SkillGroupOption {
  id: string;
  name: string;
  order: number;
  valueType: SkillGroupValueType;
  isActive: boolean;
  // Which class-level categories this group applies to — empty means every
  // category (e.g. "Psychomotor Skills"), matching the "absence means
  // applicable everywhere" semantics in schema.prisma.
  classLevelCategories: { classLevelCategory: ClassLevelCategory }[];
}
interface SkillAssessmentItemRow {
  id: string;
  groupId: string;
  name: string;
  order: number;
  isActive: boolean;
}

export function SkillAssessmentItemManager() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [groups, setGroups] = useState<SkillGroupOption[] | null>(null);
  const [items, setItems] = useState<SkillAssessmentItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Group form
  const [groupName, setGroupName] = useState("");
  const [groupOrder, setGroupOrder] = useState("1");
  const [groupValueType, setGroupValueType] = useState<SkillGroupValueType>("RATING");
  const [groupRestrictedCategories, setGroupRestrictedCategories] = useState<ClassLevelCategory[]>([]);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);

  // Item form
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [order, setOrder] = useState("1");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then((fetched) => {
        setSessions(fetched);
        const current = fetched.find((s) => s.isCurrent);
        if (current) setAcademicSessionId(current.id);
      })
      .catch(() => setSessions([]));
  }, []);

  const loadGroups = useCallback(() => {
    if (!academicSessionId) {
      setGroups(null);
      return;
    }
    apiFetch<SkillGroupOption[]>(`/skill-groups?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setGroups)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load skill groups"));
  }, [academicSessionId]);

  // Defaults the item form's group picker to the first group once groups
  // load, without fighting a stale closure over groupId inside loadGroups.
  useEffect(() => {
    if (!groupId && groups && groups.length > 0) setGroupId(groups[0]!.id);
  }, [groups, groupId]);

  const loadItems = useCallback(() => {
    if (!academicSessionId) {
      setItems(null);
      return;
    }
    apiFetch<SkillAssessmentItemRow[]>(`/skill-assessment-items?academicSessionId=${academicSessionId}`, {
      auth: true,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load skill assessment items"));
  }, [academicSessionId]);

  useEffect(() => {
    loadGroups();
    loadItems();
  }, [loadGroups, loadItems]);

  function resetGroupForm() {
    setGroupName("");
    setGroupOrder("1");
    setGroupValueType("RATING");
    setGroupRestrictedCategories([]);
  }

  function startEditGroup(group: SkillGroupOption) {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupOrder(String(group.order));
    setGroupValueType(group.valueType);
    setGroupRestrictedCategories(group.classLevelCategories.map((c) => c.classLevelCategory));
  }

  function cancelEditGroup() {
    setEditingGroupId(null);
    resetGroupForm();
  }

  async function handleGroupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGroupSubmitting(true);
    try {
      if (editingGroupId) {
        await apiFetch(`/skill-groups/${editingGroupId}`, {
          method: "PATCH",
          auth: true,
          body: { name: groupName, order: Number(groupOrder), valueType: groupValueType, classLevelCategories: groupRestrictedCategories },
        });
        setEditingGroupId(null);
      } else {
        await apiFetch("/skill-groups", {
          method: "POST",
          auth: true,
          body: {
            academicSessionId,
            name: groupName,
            order: Number(groupOrder),
            valueType: groupValueType,
            classLevelCategories: groupRestrictedCategories,
          },
        });
      }
      resetGroupForm();
      loadGroups();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setGroupSubmitting(false);
    }
  }

  async function handleDeleteGroup(id: string) {
    setError(null);
    try {
      await apiFetch(`/skill-groups/${id}`, { method: "DELETE", auth: true });
      setDeletingGroupId(null);
      loadGroups();
      loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete skill group — it may still have items in it");
    }
  }

  function resetForm() {
    setName("");
    setOrder("1");
    setIsActive(true);
  }

  function startEdit(item: SkillAssessmentItemRow) {
    setEditingId(item.id);
    setGroupId(item.groupId);
    setName(item.name);
    setOrder(String(item.order));
    setIsActive(item.isActive);
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
      if (editingId) {
        await apiFetch(`/skill-assessment-items/${editingId}`, {
          method: "PATCH",
          auth: true,
          body: { groupId, name, order: Number(order), isActive },
        });
        setEditingId(null);
      } else {
        await apiFetch("/skill-assessment-items", {
          method: "POST",
          auth: true,
          body: { academicSessionId, groupId, name, order: Number(order) },
        });
      }
      resetForm();
      loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/skill-assessment-items/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete skill assessment item");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <Label htmlFor="sai-session">Academic session</Label>
        <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
          <SelectTrigger id="sai-session" className="mt-1">
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted">
          A session with no items yet is auto-filled (groups and items both) from the most recent prior session on first load.
        </p>
      </div>

      {groups && (
        <Card className="bg-card-inset">
          <CardHeader
            title="Skill groups"
            sub={'Each group is its own titled section on the report card (e.g. "Psychomotor Skills", or a class-level-specific group like Reception’s "Numbers"). Create a group here, then assign items to it below.'}
          />
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                <span>
                  {group.name} <span className="font-mono text-muted">(order {group.order})</span>{" "}
                  {group.valueType === "RANGE_TEXT" && <Badge variant="info">Range</Badge>}{" "}
                  {group.classLevelCategories.length > 0 && (
                    <Badge variant="muted">{group.classLevelCategories.map((c) => c.classLevelCategory).join(", ")} only</Badge>
                  )}{" "}
                  {!group.isActive && <Badge variant="muted">Inactive</Badge>}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => startEditGroup(group)}>
                    Edit
                  </Button>
                  <AlertDialog open={deletingGroupId === group.id} onOpenChange={(open) => setDeletingGroupId(open ? group.id : null)}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle className="text-lg font-semibold">Delete {group.name}?</AlertDialogTitle>
                      <AlertDialogDescription className="mt-2 text-sm text-muted">
                        This also deletes every item in this group, and every rating already recorded against them. Cannot be undone.
                      </AlertDialogDescription>
                      <div className="mt-4 flex justify-end gap-2">
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <Button onClick={() => handleDeleteGroup(group.id)}>Confirm delete</Button>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
            {groups.length === 0 && <p className="text-sm text-muted">No skill groups yet — add one below.</p>}
          </div>

          <form onSubmit={handleGroupSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <FormField
              label="Group name (e.g. Numbers)"
              id="sg-name"
              required
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <FormField label="Order" id="sg-order" type="number" required value={groupOrder} onChange={(e) => setGroupOrder(e.target.value)} />
            <div>
              <Label htmlFor="sg-value-type">Items entered as</Label>
              <Select value={groupValueType} onValueChange={(v) => setGroupValueType(v as SkillGroupValueType)}>
                <SelectTrigger id="sg-value-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALUE_TYPES.map((vt) => (
                    <SelectItem key={vt} value={vt}>
                      {VALUE_TYPE_LABEL[vt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sg-class-groups">Applies to</Label>
              <MultiSelect
                id="sg-class-groups"
                value={groupRestrictedCategories}
                onValueChange={(v) => setGroupRestrictedCategories(v as ClassLevelCategory[])}
                options={CLASS_GROUPS.map((g) => ({ value: g, label: g }))}
                placeholder="Every class group"
                className="mt-1"
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" size="sm" disabled={groupSubmitting}>
                {groupSubmitting ? "Saving…" : editingGroupId ? "Save changes" : "Add group"}
              </Button>
              {editingGroupId && (
                <Button type="button" variant="outline" size="sm" onClick={cancelEditGroup}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {items && groups && (
        <>
          {groups.map((group) => {
            const groupItems = items.filter((i) => i.groupId === group.id).sort((a, b) => a.order - b.order);
            return (
              <div key={group.id}>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{group.name}</div>
                <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                  {groupItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                      <span>
                        {item.name} <span className="font-mono text-muted">(order {item.order})</span>{" "}
                        {!item.isActive && <Badge variant="muted">Inactive</Badge>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)}>
                          Edit
                        </Button>
                        <AlertDialog open={deletingId === item.id} onOpenChange={(open) => setDeletingId(open ? item.id : null)}>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle className="text-lg font-semibold">Delete {item.name}?</AlertDialogTitle>
                            <AlertDialogDescription className="mt-2 text-sm text-muted">
                              This cannot be undone.
                            </AlertDialogDescription>
                            <div className="mt-4 flex justify-end gap-2">
                              <AlertDialogCancel asChild>
                                <Button variant="outline">Cancel</Button>
                              </AlertDialogCancel>
                              <Button onClick={() => handleDelete(item.id)}>Confirm delete</Button>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                  {groupItems.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                </div>
              </div>
            );
          })}
          {groups.length === 0 && <p className="text-sm text-muted">Create a skill group above before adding items.</p>}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="sai-group">Group</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="sai-group" className="mt-1">
                  <SelectValue placeholder="Select group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormField label="Name (e.g. Punctuality)" id="sai-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <FormField label="Order" id="sai-order" type="number" required value={order} onChange={(e) => setOrder(e.target.value)} />
            {editingId ? (
              <div className="flex items-end gap-2 self-end">
                <label className="mb-2.5 flex items-center gap-1.5 text-[12.5px]">
                  <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
                  Active
                </label>
                <Button type="submit" disabled={submitting || !groupId}>
                  {submitting ? "Saving…" : "Save changes"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="submit" disabled={submitting || !groupId} className="self-end">
                {submitting ? "Adding…" : "Add item"}
              </Button>
            )}
          </form>
        </>
      )}
      {!items && <p className="text-sm text-muted">Select an academic session to manage skill items.</p>}
    </div>
  );
}
