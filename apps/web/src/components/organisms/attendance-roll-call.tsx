"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { cn } from "../../lib/cn";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export type RollCallMode = "STUDENT_DAILY" | "STUDENT_PERIOD" | "STAFF_DAILY";

interface RosterPerson {
  id: string;
  primaryLabel: string;
  secondaryLabel: string;
}

interface StudentListItem {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}

interface StaffProfileItem {
  id: string;
  employeeId: string | null;
  status: string;
  user: { firstName: string; lastName: string };
}

interface AttendanceSessionListItem {
  id: string;
  kind: "DAILY" | "PERIOD";
  subjectId: string | null;
  period: string | null;
}

interface AttendanceSessionDetail {
  id: string;
  records: { id: string; personId: string; status: AttendanceStatus }[];
}

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; short: string; activeClass: string }> = {
  PRESENT: { label: "Present", short: "P", activeClass: "border-success bg-success-bg text-success" },
  LATE: { label: "Late", short: "L", activeClass: "border-warning bg-warning-bg text-warning" },
  ABSENT: { label: "Absent", short: "A", activeClass: "border-danger bg-danger-bg text-danger" },
  EXCUSED: { label: "Excused", short: "E", activeClass: "border-info bg-info-bg text-info" },
};
const STATUS_ORDER: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "EXCUSED"];

/**
 * PRD FR5.1/FR5.3, ARCHITECTURE (attendance): `POST /attendance-sessions`
 * creates a session and every one of its records in a single call — there is
 * no separate "create session" step. Once a session exists for this exact
 * classArm/type/kind/subject/period/date combo, correcting it is one
 * `PATCH /attendance-records/:id` per record (no bulk-edit route), so this
 * component has two modes: no session yet → local edits + one batch POST
 * ("create mode"); session exists → each toggle click PATCHes immediately
 * ("edit mode"). `AttendanceRecord` carries no embedded person name (a
 * polymorphic personId/personType pair, no FK relation Prisma can declare
 * both ways), so the roster is always fetched separately and joined by id.
 */
export function AttendanceRollCall({
  mode,
  classArmId,
  subjectId,
  date,
  period,
  backdateWindowDays,
}: {
  mode: RollCallMode;
  classArmId?: string;
  subjectId?: string;
  date: string;
  period?: string;
  backdateWindowDays: number;
}) {
  const [roster, setRoster] = useState<RosterPerson[] | null>(null);
  const [existingSessionId, setExistingSessionId] = useState<string | null>(null);
  const [statusByPerson, setStatusByPerson] = useState<Record<string, AttendanceStatus>>({});
  const [recordIdByPerson, setRecordIdByPerson] = useState<Record<string, string>>({});
  const [rowState, setRowState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = mode === "STAFF_DAILY" ? "STAFF" : "STUDENT";
  const kind = mode === "STUDENT_PERIOD" ? "PERIOD" : "DAILY";
  const ready = mode === "STAFF_DAILY" ? Boolean(date) : Boolean(classArmId && date && (mode !== "STUDENT_PERIOD" || subjectId));

  const load = useCallback(async () => {
    if (!ready) {
      setRoster(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rosterPeople: RosterPerson[] =
        mode === "STAFF_DAILY"
          ? (await apiFetch<StaffProfileItem[]>("/staff-profiles", { auth: true }))
              .filter((s) => s.status === "ACTIVE")
              .map((s) => ({ id: s.id, primaryLabel: `${s.user.firstName} ${s.user.lastName}`, secondaryLabel: s.employeeId ?? "—" }))
          : (await apiFetch<StudentListItem[]>(`/students?classArmId=${classArmId}`, { auth: true })).map((s) => ({
              id: s.id,
              primaryLabel: `${s.user.firstName} ${s.user.lastName}`,
              secondaryLabel: s.admissionNumber,
            }));
      setRoster(rosterPeople);

      const qs = new URLSearchParams({ type, from: date, to: date });
      if (classArmId && mode !== "STAFF_DAILY") qs.set("classArmId", classArmId);
      const sessions = await apiFetch<AttendanceSessionListItem[]>(`/attendance-sessions?${qs.toString()}`, { auth: true });
      const match = sessions.find(
        (s) => s.kind === kind && (s.subjectId ?? null) === (subjectId ?? null) && (s.period ?? null) === (period ?? null),
      );

      if (match) {
        const detail = await apiFetch<AttendanceSessionDetail>(`/attendance-sessions/${match.id}`, { auth: true });
        const statusMap: Record<string, AttendanceStatus> = {};
        const recordIdMap: Record<string, string> = {};
        for (const record of detail.records) {
          statusMap[record.personId] = record.status;
          recordIdMap[record.personId] = record.id;
        }
        setExistingSessionId(detail.id);
        setStatusByPerson(statusMap);
        setRecordIdByPerson(recordIdMap);
      } else {
        setExistingSessionId(null);
        setStatusByPerson({});
        setRecordIdByPerson({});
      }
      setRowState({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [ready, mode, classArmId, subjectId, date, period, type, kind]);

  useEffect(() => {
    load();
  }, [load]);

  function setStatus(personId: string, status: AttendanceStatus) {
    if (existingSessionId) {
      const recordId = recordIdByPerson[personId];
      if (!recordId) return;
      setRowState((s) => ({ ...s, [personId]: "saving" }));
      apiFetch(`/attendance-records/${recordId}`, { method: "PATCH", auth: true, body: { status } })
        .then(() => {
          setStatusByPerson((s) => ({ ...s, [personId]: status }));
          setRowState((s) => ({ ...s, [personId]: "saved" }));
        })
        .catch((err) => {
          setRowState((s) => ({ ...s, [personId]: "error" }));
          setError(err instanceof ApiError ? err.message : "Failed to update record");
        });
    } else {
      setStatusByPerson((s) => ({ ...s, [personId]: status }));
    }
  }

  function markAllPresent() {
    if (existingSessionId || !roster) return;
    setStatusByPerson(Object.fromEntries(roster.map((p) => [p.id, "PRESENT" as AttendanceStatus])));
  }

  async function handleSaveRegister() {
    const records = Object.entries(statusByPerson).map(([personId, status]) => ({ personId, status }));
    if (records.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/attendance-sessions", {
        method: "POST",
        auth: true,
        body: {
          type,
          kind,
          classArmId: mode === "STAFF_DAILY" ? undefined : classArmId,
          date,
          subjectId: mode === "STUDENT_PERIOD" ? subjectId : undefined,
          period: period || undefined,
          records,
        },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save register");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-muted">Select a class and date above to begin.</p>;
  }
  if (loading && !roster) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  const markedCount = Object.keys(statusByPerson).length;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger">{error}</p>}

      {!existingSessionId && (
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted">
            {markedCount} of {roster?.length ?? 0} marked
          </p>
          <Button type="button" variant="outline" size="sm" onClick={markAllPresent}>
            Mark all present
          </Button>
        </div>
      )}
      {existingSessionId && (
        <p className="text-[12px] text-muted">
          Register already taken — edits save immediately. Corrections older than {backdateWindowDays} day(s) may require
          Admin override.
        </p>
      )}

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">
                {mode === "STAFF_DAILY" ? "Staff" : "Student"}
              </th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {roster?.length === 0 && (
              <tr>
                <td colSpan={2} className="py-3 text-muted">
                  No one to mark for this selection.
                </td>
              </tr>
            )}
            {roster?.map((person) => (
              <tr key={person.id} className="border-b border-border/60 last:border-none">
                <td className="py-2.5 pr-4 font-medium">
                  {person.primaryLabel} <span className="font-mono text-muted">({person.secondaryLabel})</span>
                </td>
                <td className="py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {STATUS_ORDER.map((status) => {
                      const config = STATUS_CONFIG[status];
                      const active = statusByPerson[person.id] === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          title={config.label}
                          onClick={() => setStatus(person.id, status)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                            active ? config.activeClass : "border-border text-muted hover:bg-card-inset",
                          )}
                        >
                          {config.short}
                        </button>
                      );
                    })}
                    {rowState[person.id] === "saving" && <span className="text-[11px] text-muted">Saving…</span>}
                    {rowState[person.id] === "saved" && <span className="text-[11px] text-success">Saved</span>}
                    {rowState[person.id] === "error" && <span className="text-[11px] text-danger">Failed</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!existingSessionId && (
        <Button type="button" disabled={submitting || markedCount === 0} onClick={handleSaveRegister}>
          {submitting ? "Saving…" : "Save register"}
        </Button>
      )}
    </div>
  );
}
