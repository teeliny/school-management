"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
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

interface ClassLevelOption {
  id: string;
  name: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
}
interface TermOption {
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
  isCompulsoryOverride: boolean | null;
  subject: SubjectOption & { isGroup: boolean; childSubjects: ChildSubject[] };
  termStatuses: TermStatus[];
}

// PRD §3.3: ClassSubject is the source of truth for "which subjects exist
// for which class this session" — this picks a (classLevel, session) pair,
// lists what's currently assigned, and lets Admin assign more or override a
// subject's default applicability for this specific class.
export function ClassSubjectAssignment() {
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevelId, setClassLevelId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [assigned, setAssigned] = useState<ClassSubjectRow[] | null>(null);
  const [subjectToAdd, setSubjectToAdd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
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
    if (!classLevelId || !academicSessionId) {
      setAssigned(null);
      return;
    }
    apiFetch<ClassSubjectRow[]>(
      `/class-subjects?classLevelId=${classLevelId}&academicSessionId=${academicSessionId}`,
      { auth: true },
    )
      .then(setAssigned)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load"));
  }, [classLevelId, academicSessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const unassignedSubjects = subjects.filter((s) => !assigned?.some((a) => a.subjectId === s.id));

  async function assignSubject() {
    setError(null);
    try {
      await apiFetch("/class-subjects", {
        method: "POST",
        auth: true,
        body: { classLevelId, subjectId: subjectToAdd, academicSessionId },
      });
      setSubjectToAdd("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign subject");
    }
  }

  async function toggleOverride(row: ClassSubjectRow, value: boolean | null) {
    setError(null);
    try {
      await apiFetch(`/class-subjects/${row.id}`, {
        method: "PATCH",
        auth: true,
        body: { isCompulsoryOverride: value },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update override");
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

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="cs-class-level">Class level</Label>
          <Select value={classLevelId} onValueChange={setClassLevelId}>
            <SelectTrigger id="cs-class-level" className="mt-1">
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
        <div>
          <Label htmlFor="cs-session">Academic session</Label>
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
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Subject</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Compulsory override</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">
                  {termId ? "Status this term" : "Status (select a term to disable)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {assigned.map((row) => {
                const active = isActiveForTerm(row, row.subjectId);
                return (
                  <Fragment key={row.id}>
                    <tr className="border-b border-border/60 last:border-none">
                      <td className="py-2.5 pr-4">
                        {row.subject.name} <span className="font-mono text-muted">({row.subject.code})</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5">
                            <Checkbox
                              checked={row.isCompulsoryOverride === true}
                              onCheckedChange={(v) => toggleOverride(row, v === true ? true : null)}
                            />
                            Force compulsory
                          </label>
                          <label className="flex items-center gap-1.5">
                            <Checkbox
                              checked={row.isCompulsoryOverride === false}
                              onCheckedChange={(v) => toggleOverride(row, v === true ? false : null)}
                            />
                            Force non-compulsory
                          </label>
                        </div>
                      </td>
                      <td className="py-2.5">
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
                  <td colSpan={3} className="py-2.5 text-muted">
                    No subjects assigned to this class yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="flex items-end gap-3">
            <div className="flex-1">
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
            <Button type="button" disabled={!subjectToAdd} onClick={assignSubject}>
              Assign
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
