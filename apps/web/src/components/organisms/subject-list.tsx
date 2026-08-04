"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";

export interface SubjectListItem {
  id: string;
  name: string;
  code: string;
  type: "COMPULSORY" | "GENERAL" | "DEPARTMENT";
  isGroup: boolean;
  requiresCalculation: boolean;
  departmentId?: string | null;
  department?: { name: string } | null;
}

const TYPE_VARIANT: Record<SubjectListItem["type"], BadgeVariant> = {
  COMPULSORY: "info",
  GENERAL: "muted",
  DEPARTMENT: "warning",
};

// PRD §3.3: only top-level subjects are listed here (SubjectService.findAll
// excludes children of a group — they're taught/scored independently but
// only surfaced via their parent's detail view). "Edit" hands the subject up
// to the parent page, which populates the Create-subject form for editing
// (see CreateSubjectForm's editingSubject prop) rather than editing inline.
export function SubjectList({
  canManage,
  refreshKey,
  onEdit,
}: {
  canManage?: boolean;
  refreshKey?: unknown;
  onEdit?: (subject: SubjectListItem) => void;
}) {
  const [subjects, setSubjects] = useState<SubjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<SubjectListItem[]>("/subjects", { auth: true })
      .then(setSubjects)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load subjects"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!subjects) return <p className="text-sm text-muted">Loading…</p>;
  if (subjects.length === 0) return <p className="text-sm text-muted">No subjects defined yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Code</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Name</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Type</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Notes</th>
            {canManage && <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {subjects.map((subject) => (
            <tr key={subject.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-4 font-mono text-muted">{subject.code}</td>
              <td className="py-2.5 pr-4 font-medium">
                {subject.name}
                {subject.department && (
                  <span className="ml-1.5 text-muted">({subject.department.name})</span>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <Badge variant={TYPE_VARIANT[subject.type]}>{subject.type}</Badge>
              </td>
              <td className="py-2.5 pr-4">
                <div className="flex gap-1.5">
                  {subject.isGroup && <Badge variant="info">Group</Badge>}
                  {subject.requiresCalculation && <Badge variant="muted">Calculation</Badge>}
                </div>
              </td>
              {canManage && (
                <td className="py-2.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit?.(subject)}>
                    Edit
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
