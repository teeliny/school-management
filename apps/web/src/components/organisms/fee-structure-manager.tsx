"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";
import { FeeStructureAssignmentPanel } from "./fee-structure-assignment-panel";
import { FeeStructureWaiverPanel } from "./fee-structure-waiver-panel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
}
interface FeeStructureItem {
  id: string;
  name: string;
  amount: number;
  isMandatory: boolean;
  // Zero entries = school-wide; one or more = scoped to just those class
  // levels (FeeStructureClassLevel join, replacing the old single-nullable
  // classLevelId column).
  classLevels: { classLevelId: string }[];
}

// Bursar/Super-Admin only (GET /fee-structures is itself gated to
// `manage FeeStructure`) — zero classLevels rows applies to every class level.
export function FeeStructureManager() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState("");
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [structures, setStructures] = useState<FeeStructureItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [classLevelIds, setClassLevelIds] = useState<string[]>([]);
  const [isMandatory, setIsMandatory] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editClassLevelIds, setEditClassLevelIds] = useState<string[]>([]);
  const [editIsMandatory, setEditIsMandatory] = useState(true);
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Which optional (isMandatory=false) fee structure's opt-in panel is open —
  // at most one at a time.
  const [assignmentPanelId, setAssignmentPanelId] = useState<string | null>(null);
  // Which mandatory fee structure's waiver panel is open — separate from
  // assignmentPanelId since the two are mutually exclusive by isMandatory.
  const [waiverPanelId, setWaiverPanelId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then((fetched) => {
        setSessions(fetched);
        const current = fetched.find((s) => s.isCurrent);
        if (current) setAcademicSessionId(current.id);
      })
      .catch(() => setSessions([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
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
    if (!termId) {
      setStructures(null);
      return;
    }
    apiFetch<FeeStructureItem[]>(`/fee-structures?termId=${termId}`, { auth: true })
      .then(setStructures)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load fee structures"));
  }, [termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/fee-structures", {
        method: "POST",
        auth: true,
        body: {
          academicSessionId,
          termId,
          classLevelIds: classLevelIds.length ? classLevelIds : undefined,
          name,
          amount: Number(amount),
          isMandatory,
        },
      });
      setName("");
      setAmount("");
      setClassLevelIds([]);
      setIsMandatory(true);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(structure: FeeStructureItem) {
    setEditingId(structure.id);
    setEditName(structure.name);
    setEditAmount(String(structure.amount));
    setEditClassLevelIds(structure.classLevels.map((l) => l.classLevelId));
    setEditIsMandatory(structure.isMandatory);
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/fee-structures/${id}`, {
        method: "PATCH",
        auth: true,
        body: {
          name: editName,
          amount: Number(editAmount),
          classLevelIds: editClassLevelIds,
          isMandatory: editIsMandatory,
        },
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update fee structure");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/fee-structures/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete fee structure");
    }
  }

  function classLevelNames(levels: { classLevelId: string }[]) {
    if (levels.length === 0) return "Whole school";
    return levels.map((l) => classLevels.find((c) => c.id === l.classLevelId)?.name ?? "—").join(", ");
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fs-session">Academic session</Label>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger id="fs-session" className="mt-1">
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
          <Label htmlFor="fs-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="fs-term" className="mt-1">
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

      {termId && (
        <>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {structures === null && <SkeletonList rows={3} />}
            {structures?.map((structure) =>
              editingId === structure.id ? (
                <div key={structure.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-2">
                  <FormField label="Name" id={`fs-edit-name-${structure.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <FormField
                    label="Amount"
                    id={`fs-edit-amount-${structure.id}`}
                    type="number"
                    min="0.01"
                    step="any"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                  />
                  <div>
                    <Label htmlFor={`fs-edit-class-levels-${structure.id}`}>Class levels (none = whole school)</Label>
                    <MultiSelect
                      id={`fs-edit-class-levels-${structure.id}`}
                      className="mt-1"
                      value={editClassLevelIds}
                      onValueChange={setEditClassLevelIds}
                      placeholder="Whole school"
                      options={classLevels.map((level) => ({ value: level.id, label: level.name }))}
                    />
                  </div>
                  <div className="flex items-center gap-2 self-end pb-2.5">
                    <Checkbox
                      id={`fs-edit-mandatory-${structure.id}`}
                      checked={editIsMandatory}
                      onCheckedChange={(checked) => setEditIsMandatory(checked === true)}
                    />
                    <Label htmlFor={`fs-edit-mandatory-${structure.id}`}>Mandatory</Label>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(structure.id)}>
                      Save
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={structure.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {structure.name} <span className="text-muted">({classLevelNames(structure.classLevels)})</span>{" "}
                      <span className="font-mono">{formatCurrency(structure.amount)}</span>
                      {structure.isMandatory && <span className="text-muted"> · mandatory</span>}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!structure.isMandatory && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setAssignmentPanelId(assignmentPanelId === structure.id ? null : structure.id)}
                        >
                          {assignmentPanelId === structure.id ? "Hide opt-ins" : "Manage opt-ins"}
                        </Button>
                      )}
                      {structure.isMandatory && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setWaiverPanelId(waiverPanelId === structure.id ? null : structure.id)}
                        >
                          {waiverPanelId === structure.id ? "Hide waivers" : "Waive for students…"}
                        </Button>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={() => startEdit(structure)}>
                        Edit
                      </Button>
                      <AlertDialog open={deletingId === structure.id} onOpenChange={(open) => setDeletingId(open ? structure.id : null)}>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm">
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogTitle className="text-lg font-semibold">Delete {structure.name}?</AlertDialogTitle>
                          <AlertDialogDescription className="mt-2 text-sm text-muted">
                            This does not change any invoice already generated from it. This cannot be undone.
                          </AlertDialogDescription>
                          <div className="mt-4 flex justify-end gap-2">
                            <AlertDialogCancel asChild>
                              <Button variant="outline">Cancel</Button>
                            </AlertDialogCancel>
                            <Button onClick={() => handleDelete(structure.id)}>Confirm delete</Button>
                          </div>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  {assignmentPanelId === structure.id && <FeeStructureAssignmentPanel feeStructureId={structure.id} />}
                  {waiverPanelId === structure.id && <FeeStructureWaiverPanel feeStructureId={structure.id} />}
                </div>
              ),
            )}
            {structures?.length === 0 && <EmptyState icon={Wallet} title="No fee structures for this term yet" />}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Name (e.g. Tuition)" id="fs-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <FormField
              label="Amount"
              id="fs-amount"
              type="number"
              min="0.01"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div>
              <Label htmlFor="fs-class-levels">Class levels (none = whole school)</Label>
              <MultiSelect
                id="fs-class-levels"
                className="mt-1"
                value={classLevelIds}
                onValueChange={setClassLevelIds}
                placeholder="Whole school"
                options={classLevels.map((level) => ({ value: level.id, label: level.name }))}
              />
            </div>
            <div className="flex items-center gap-2 self-end pb-2.5">
              <Checkbox id="fs-mandatory" checked={isMandatory} onCheckedChange={(checked) => setIsMandatory(checked === true)} />
              <Label htmlFor="fs-mandatory">Mandatory</Label>
            </div>
            <Button type="submit" disabled={submitting} className="sm:col-span-2">
              {submitting ? "Creating…" : "Create fee structure"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
