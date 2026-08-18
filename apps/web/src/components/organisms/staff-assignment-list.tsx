"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
import { ASSIGNMENT_TYPE_LABELS, type AssignmentType } from "./staff-assignment-form";

interface StaffAssignment {
  id: string;
  staffId: string;
  assignmentType: AssignmentType;
  classArmId: string | null;
  subjectId: string | null;
  academicSessionId: string;
  isActive: boolean;
  subject: { name: string } | null;
  classArm: { name: string; displayName: string } | null;
  academicSession: { name: string };
  staff: { user: { firstName: string; lastName: string } };
}

interface TeacherSummary {
  staffId: string;
  staffName: string;
  classTeacherAssignments: StaffAssignment[];
  subjectGroups: { subjectId: string; subjectName: string; classArms: { id: string; displayName: string; assignmentId: string }[] }[];
  otherAssignments: StaffAssignment[];
}

// Only *active* assignments are summarized here — this is a "what's true
// right now" view, not an audit trail of revoked history.
function groupByStaff(assignments: StaffAssignment[]): TeacherSummary[] {
  const active = assignments.filter((a) => a.isActive);
  const byStaff = new Map<string, StaffAssignment[]>();
  for (const assignment of active) {
    const list = byStaff.get(assignment.staffId) ?? [];
    list.push(assignment);
    byStaff.set(assignment.staffId, list);
  }

  return [...byStaff.entries()].map(([staffId, rows]) => {
    const staffName = `${rows[0]!.staff.user.firstName} ${rows[0]!.staff.user.lastName}`;
    const classTeacherAssignments = rows.filter((a) => a.assignmentType === "CLASS_TEACHER");
    const subjectRows = rows.filter((a) => a.assignmentType === "SUBJECT_TEACHER");
    const otherAssignments = rows.filter(
      (a) => a.assignmentType !== "CLASS_TEACHER" && a.assignmentType !== "SUBJECT_TEACHER",
    );

    const bySubject = new Map<string, StaffAssignment[]>();
    for (const row of subjectRows) {
      if (!row.subjectId) continue;
      const list = bySubject.get(row.subjectId) ?? [];
      list.push(row);
      bySubject.set(row.subjectId, list);
    }

    const subjectGroups = [...bySubject.entries()].map(([subjectId, subjectRowsForId]) => ({
      subjectId,
      subjectName: subjectRowsForId[0]!.subject?.name ?? "Unknown subject",
      classArms: subjectRowsForId
        .filter((row) => row.classArmId && row.classArm)
        .map((row) => ({ id: row.classArmId!, displayName: row.classArm!.displayName, assignmentId: row.id })),
    }));

    return { staffId, staffName, classTeacherAssignments, subjectGroups, otherAssignments };
  });
}

export function StaffAssignmentList({ refreshKey }: { refreshKey?: unknown }) {
  const [assignments, setAssignments] = useState<StaffAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<StaffAssignment[]>("/staff-assignments", { auth: true })
      .then(setAssignments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load assignments"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await apiFetch(`/staff-assignments/${id}/revoke`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke assignment");
    } finally {
      setRevokingId(null);
    }
  }

  const summaries = useMemo(() => (assignments ? groupByStaff(assignments) : []), [assignments]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!assignments) return <p className="text-sm text-muted">Loading…</p>;
  if (summaries.length === 0) return <p className="text-sm text-muted">No assignments yet.</p>;

  return (
    <div className="max-h-[420px] space-y-4 overflow-auto text-[12.5px]">
      {summaries.map((summary) => (
        <div key={summary.staffId} className="space-y-2 border-b border-border/60 pb-3 last:border-none">
          <p className="font-medium">{summary.staffName}</p>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Class teacher:</span>
            {summary.classTeacherAssignments.length === 0 ? (
              <span className="text-muted">Not a class teacher</span>
            ) : (
              summary.classTeacherAssignments.map((a) => (
                <AssignmentChip
                  key={a.id}
                  label={a.classArm?.displayName ?? "Unknown arm"}
                  revoking={revokingId === a.id}
                  onRevoke={() => handleRevoke(a.id)}
                />
              ))
            )}
          </div>

          {summary.subjectGroups.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Subjects:</span>
              {summary.subjectGroups.map((group) => (
                <div key={group.subjectId} className="flex flex-wrap items-center gap-1.5 pl-2">
                  <span className="text-muted">{group.subjectName}:</span>
                  {group.classArms.map((arm) => (
                    <AssignmentChip
                      key={arm.assignmentId}
                      label={arm.displayName}
                      revoking={revokingId === arm.assignmentId}
                      onRevoke={() => handleRevoke(arm.assignmentId)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {summary.otherAssignments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Other roles:</span>
              {summary.otherAssignments.map((a) => (
                <AssignmentChip
                  key={a.id}
                  label={ASSIGNMENT_TYPE_LABELS[a.assignmentType]}
                  revoking={revokingId === a.id}
                  onRevoke={() => handleRevoke(a.id)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AssignmentChip({ label, revoking, onRevoke }: { label: string; revoking: boolean; onRevoke: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="info">{label}</Badge>
      <Button variant="outline" size="sm" disabled={revoking} onClick={onRevoke}>
        ×
      </Button>
    </span>
  );
}
