"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
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

interface ChildRow {
  name: string;
  code: string;
  weight: string;
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
export function CreateSubjectForm({ onCreated }: { onCreated?: () => void }) {
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

  useEffect(() => {
    apiFetch<DepartmentOption[]>("/departments", { auth: true }).then(setDepartments).catch(() => setDepartments([]));
  }, []);

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

      <label className="flex items-center gap-2 text-[12.5px]">
        <Checkbox checked={isGroup} onCheckedChange={(v) => setIsGroup(v === true)} />
        Grouped subject (independently-scored children, e.g. Basic Science and Technology)
      </label>

      {isGroup && (
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

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create subject"}
      </Button>
    </form>
  );
}
