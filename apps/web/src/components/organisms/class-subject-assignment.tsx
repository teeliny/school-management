"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Badge } from "../atoms/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";
import { CLASS_GROUPS, TYPE_LABELS, type ClassLevelCategory, type SubjectType } from "../../lib/subject-applicability";

interface AcademicSessionOption {
  id: string;
  name: string;
}
interface TermOption {
  id: string;
  name: string;
}
interface DepartmentOption {
  id: string;
  name: string;
}
interface SubjectOption {
  id: string;
  name: string;
  code: string;
}
interface ChildSubject {
  id: string;
  name: string;
  code: string;
}
interface TermStatus {
  subjectId: string;
  termId: string;
  isActive: boolean;
}
interface ClassSubjectRow {
  id: string;
  subjectId: string;
  type: SubjectType;
  departmentId: string | null;
  subject: SubjectOption & { isGroup: boolean; childSubjects: ChildSubject[] };
  termStatuses: TermStatus[];
}
interface RowEdit {
  type: SubjectType;
  departmentId: string;
}

// PRD §3.3: ClassSubject is the source of truth for "which subjects exist
// for which class group, and how they apply" — this picks a class group
// (JSS covers JSS1-3 etc.), lists what's currently assigned, and lets Admin
// assign more or change a subject's type/department for this class group.
// type/departmentId live on the assignment itself (not on Subject) because
// the same subject can apply differently per class group — e.g. CRS is
// GENERAL for JSS but DEPARTMENT-restricted for SSS. Not session-scoped
// (curriculum structure persists until explicitly changed — see
// ClassSubject in schema.prisma); the academic session/term pickers below
// are only used to choose which term to disable a subject for.
export function ClassSubjectAssignment() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevelCategory, setClassLevelCategory] = useState<ClassLevelCategory | "">("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [assigned, setAssigned] = useState<ClassSubjectRow[] | null>(null);
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [subjectToAdd, setSubjectToAdd] = useState("");
  const [assignType, setAssignType] = useState<SubjectType>("GENERAL");
  const [assignDepartmentId, setAssignDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<DepartmentOption[]>("/departments", { auth: true }).then(setDepartments).catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    setTermId("");
    if (!academicSessionId) {
      setTerms([]);
      return;
    }
    apiFetch<TermOption[]>(`/terms?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [academicSessionId]);

  const load = useCallback(() => {
    if (!classLevelCategory) {
      setAssigned(null);
      return;
    }
    apiFetch<ClassSubjectRow[]>(`/class-subjects?classLevelCategory=${classLevelCategory}`, { auth: true })
      .then((rows) => {
        setAssigned(rows);
        setRowEdits(
          Object.fromEntries(rows.map((row) => [row.id, { type: row.type, departmentId: row.departmentId ?? "" }])),
        );
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load"));
  }, [classLevelCategory]);

  useEffect(() => {
    load();
  }, [load]);

  const unassignedSubjects = subjects.filter((s) => !assigned?.some((a) => a.subjectId === s.id));

  function updateRowEdit(rowId: string, current: RowEdit, patch: Partial<RowEdit>) {
    setRowEdits((prev) => ({ ...prev, [rowId]: { ...current, ...patch } }));
  }

  async function assignSubject() {
    setError(null);
    try {
      await apiFetch("/class-subjects", {
        method: "POST",
        auth: true,
        body: {
          classLevelCategory,
          subjectId: subjectToAdd,
          type: assignType,
          departmentId: assignType === "DEPARTMENT" ? assignDepartmentId || undefined : undefined,
        },
      });
      setSubjectToAdd("");
      setAssignType("GENERAL");
      setAssignDepartmentId("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign subject");
    }
  }

  async function saveRow(row: ClassSubjectRow) {
    const edit = rowEdits[row.id];
    if (!edit) return;
    setError(null);
    setSavingRowId(row.id);
    try {
      await apiFetch(`/class-subjects/${row.id}`, {
        method: "PATCH",
        auth: true,
        body: {
          type: edit.type,
          departmentId: edit.type === "DEPARTMENT" ? edit.departmentId || undefined : undefined,
        },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update subject applicability");
    } finally {
      setSavingRowId(null);
    }
  }

  function isActiveForTerm(row: ClassSubjectRow, subjectId: string) {
    const status = row.termStatuses.find((s) => s.subjectId === subjectId && s.termId === termId);
    return status ? status.isActive : true;
  }

  async function toggleTermStatus(row: ClassSubjectRow, subjectId: string, currentlyActive: boolean) {
    if (!termId) return;
    setError(null);
    try {
      await apiFetch(
        `/class-subjects/${row.id}/terms/${termId}/subjects/${subjectId}/${currentlyActive ? "disable" : "enable"}`,
        { method: "PATCH", auth: true },
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update subject status for this term");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="cs-class-group">Class group</Label>
          <Select value={classLevelCategory} onValueChange={(v) => setClassLevelCategory(v as ClassLevelCategory)}>
            <SelectTrigger id="cs-class-group" className="mt-1">
              <SelectValue placeholder="Select class group" />
            </SelectTrigger>
            <SelectContent>
              {CLASS_GROUPS.map((group) => (
                <SelectItem key={group} value={group}>
                  {group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cs-session">Academic session (to pick a term to disable)</Label>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger id="cs-session" className="mt-1">
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
        </div>
        <div>
          <Label htmlFor="cs-term">Term (to disable a subject for it)</Label>
          <Select value={termId} onValueChange={setTermId} disabled={!academicSessionId}>
            <SelectTrigger id="cs-term" className="mt-1">
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
      </div>

      {assigned && (
        <>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Subject</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Type</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Department</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide" />
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">
                  {termId ? "Status this term" : "Status (select a term to disable)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {assigned.map((row) => {
                const active = isActiveForTerm(row, row.subjectId);
                const edit = rowEdits[row.id] ?? { type: row.type, departmentId: row.departmentId ?? "" };
                const dirty = edit.type !== row.type || edit.departmentId !== (row.departmentId ?? "");
                return (
                  <Fragment key={row.id}>
                    <tr className="border-b border-border/60 last:border-none">
                      <td className="py-2.5 pr-4 align-top">
                        {row.subject.name} <span className="font-mono text-muted">({row.subject.code})</span>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <Select
                          value={edit.type}
                          onValueChange={(v) => updateRowEdit(row.id, edit, { type: v as SubjectType })}
                        >
                          <SelectTrigger className="min-w-[160px]">
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
                      </td>
                      <td className="py-2 pr-4 align-top">
                        {edit.type === "DEPARTMENT" && (
                          <Select
                            value={edit.departmentId}
                            onValueChange={(v) => updateRowEdit(row.id, edit, { departmentId: v })}
                          >
                            <SelectTrigger className="min-w-[160px]">
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
                        )}
                      </td>
                      <td className="py-2.5 pr-4 align-top">
                        {dirty && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              savingRowId === row.id || (edit.type === "DEPARTMENT" && !edit.departmentId)
                            }
                            onClick={() => saveRow(row)}
                          >
                            {savingRowId === row.id ? "Saving…" : "Save"}
                          </Button>
                        )}
                      </td>
                      <td className="py-2.5 align-top">
                        {termId && (
                          <div className="flex items-center gap-2">
                            <Badge variant={active ? "success" : "danger"}>{active ? "Active" : "Disabled"}</Badge>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => toggleTermStatus(row, row.subjectId, active)}
                            >
                              {active ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {row.subject.isGroup &&
                      row.subject.childSubjects.map((child) => {
                        const childActive = isActiveForTerm(row, child.id);
                        return (
                          <tr key={child.id} className="border-b border-border/60 last:border-none">
                            <td className="py-2 pr-4 pl-6 text-muted">
                              — {child.name} <span className="font-mono">({child.code})</span>
                            </td>
                            <td className="py-2 pr-4" />
                            <td className="py-2 pr-4" />
                            <td className="py-2 pr-4" />
                            <td className="py-2">
                              {termId && (
                                <div className="flex items-center gap-2">
                                  <Badge variant={childActive ? "success" : "danger"}>
                                    {childActive ? "Active" : "Disabled"}
                                  </Badge>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleTermStatus(row, child.id, childActive)}
                                  >
                                    {childActive ? "Disable" : "Enable"}
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
              {assigned.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2.5 text-muted">
                    No subjects assigned to this class group yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="cs-add-subject">Assign a subject</Label>
              <Select value={subjectToAdd} onValueChange={setSubjectToAdd}>
                <SelectTrigger id="cs-add-subject" className="mt-1">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <Label htmlFor="cs-add-type">Type</Label>
              <Select value={assignType} onValueChange={(v) => setAssignType(v as SubjectType)}>
                <SelectTrigger id="cs-add-type" className="mt-1">
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
            {assignType === "DEPARTMENT" && (
              <div className="min-w-[180px]">
                <Label htmlFor="cs-add-department">Department</Label>
                <Select value={assignDepartmentId} onValueChange={setAssignDepartmentId}>
                  <SelectTrigger id="cs-add-department" className="mt-1">
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
            <Button
              type="button"
              disabled={!subjectToAdd || (assignType === "DEPARTMENT" && !assignDepartmentId)}
              onClick={assignSubject}
            >
              Assign
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
