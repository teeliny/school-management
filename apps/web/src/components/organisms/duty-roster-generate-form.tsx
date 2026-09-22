"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";

type ClassLevelCategoryGroup = "JSS_SSS" | "CRECHE_NURSERY_PRIMARY";

/**
 * The manual counterpart to TriggerGenerationForm's WEEKLY_DUTY case — no
 * async solve to wait on, so this just posts and refreshes on success.
 * Teachers rotate automatically (round-robin over the group's eligible
 * staff); topics are always left blank for Admin to fill in afterward via
 * DutyGrid's inline editor, matching the paper roster this was built from.
 */
export function DutyRosterGenerateForm({
  termId,
  classLevelCategoryGroup,
  onGenerated,
}: {
  termId: string;
  classLevelCategoryGroup: ClassLevelCategoryGroup;
  onGenerated: () => void;
}) {
  const [teachersPerWeek, setTeachersPerWeek] = useState("2");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    const n = Number(teachersPerWeek);
    if (!Number.isInteger(n) || n < 1) {
      setError("Teachers per week must be a positive whole number");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/duty-roster-weeks/generate", {
        method: "POST",
        auth: true,
        body: { termId, classLevelCategoryGroup, teachersPerWeek: n },
      });
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate the duty roster");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm space-y-3 rounded-lg border border-dashed border-border p-4">
      <p className="text-[12.5px] text-muted">
        No duty roster yet for this term. Generate one — teachers rotate automatically week by week; weekly topics are
        left blank for you to fill in.
      </p>
      <div>
        <Label htmlFor="duty-teachers-per-week">Teachers per week</Label>
        <Input
          id="duty-teachers-per-week"
          type="number"
          min={1}
          value={teachersPerWeek}
          onChange={(e) => setTeachersPerWeek(e.target.value)}
          className="mt-1 w-24"
        />
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <Button type="button" size="sm" disabled={submitting} onClick={handleGenerate}>
        {submitting ? "Generating…" : "Generate roster"}
      </Button>
    </div>
  );
}
