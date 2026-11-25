"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { InvoiceGenerationPreview } from "./invoice-generation-preview";

interface TermOption {
  id: string;
  name: string;
}
interface ClassLevelOption {
  id: string;
  name: string;
}
interface GenerateResult {
  created: number;
  alreadyInvoiced: number;
  noApplicableFees: number;
}

const WHOLE_SCHOOL = "__whole_school__";

/**
 * PRD FR7.2: one Invoice per ACTIVE student in scope, skipping anyone already
 * invoiced for the term. Once a term is picked, InvoiceGenerationPreview
 * shows the same scope as a dry run (who's still to be invoiced and each
 * student's fee lines) so the Bursar can check it before generating.
 */
export function GenerateInvoicesForm({ onGenerated }: { onGenerated?: () => void }) {
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [classLevels, setClassLevels] = useState<ClassLevelOption[]>([]);
  const [termId, setTermId] = useState("");
  const [classLevelId, setClassLevelId] = useState(WHOLE_SCHOOL);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  useEffect(() => {
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }).then(setClassLevels).catch(() => setClassLevels([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const generated = await apiFetch<GenerateResult>("/invoices/generate", {
        method: "POST",
        auth: true,
        body: { termId, classLevelId: classLevelId === WHOLE_SCHOOL ? undefined : classLevelId, dueDate },
      });
      setResult(generated);
      setPreviewRefreshKey((k) => k + 1);
      onGenerated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate invoices");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <p className="text-[12.5px] text-success">
            {result.created} invoice(s) created · {result.alreadyInvoiced} already invoiced · {result.noApplicableFees} with no
            applicable fees
          </p>
        )}

        <div>
          <Label htmlFor="gi-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="gi-term" className="mt-1">
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
        <div>
          <Label htmlFor="gi-class-level">Class level</Label>
          <Select value={classLevelId} onValueChange={setClassLevelId}>
            <SelectTrigger id="gi-class-level" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_SCHOOL}>Whole school</SelectItem>
              {classLevels.map((level) => (
                <SelectItem key={level.id} value={level.id}>
                  {level.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormField label="Due date" id="gi-due-date" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <Button type="submit" disabled={submitting || !termId || !dueDate}>
          {submitting ? "Generating…" : "Generate invoices"}
        </Button>
      </form>

      {/* Outside the <form> so pressing Enter in the preview's search box can't submit Generate. */}
      {termId && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Preview</p>
          <InvoiceGenerationPreview
            termId={termId}
            classLevelId={classLevelId === WHOLE_SCHOOL ? undefined : classLevelId}
            refreshKey={previewRefreshKey}
          />
        </div>
      )}
    </div>
  );
}
