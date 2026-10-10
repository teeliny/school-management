"use client";

import { useEffect, useState } from "react";
import { categoryToGroup, examArrangementFor, type ClassLevelCategory, type ExamArrangement } from "@school/types";
import { groupComponentsBySitting } from "../../lib/exam-sittings";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: ClassLevelCategory };
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface AssessmentComponentOption {
  id: string;
  name: string;
  type: "CA" | "MID_TERM" | "EXAM";
  termId: string;
  classLevelCategory: ClassLevelCategory;
  sequence: number;
}

/** Plain-language summary of a component's exam sitting (examArrangementFor), shown under the picker. */
function describeArrangement(arrangement: ExamArrangement, scope: Scope): string {
  const sitting = arrangement.sittingCategories.join(" + ");
  const timetable = arrangement.unified
    ? `One combined timetable for ${sitting} — every class sits its papers in the same fixed slots.`
    : `One run for ${sitting}, laid out per class arm — papers per day follow the configured slots/duration.`;
  const invigilation =
    arrangement.invigilation === "CLASS_TEACHER"
      ? "Invigilated by each class's own class teacher(s)."
      : arrangement.invigilation === "ONE_PER_ARM_PER_DAY"
        ? "One teacher per class arm per day."
        : `A fixed number of hall invigilators per day${arrangement.poolClassTeachersOnly ? ", drawn from the class teachers only" : ""}.`;
  return scope === "EXAM_TIMETABLE" ? timetable : invigilation;
}

type Scope = "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";

const SCOPE_LABEL: Record<Scope, string> = {
  CLASS_TIMETABLE: "Class timetable",
  EXAM_TIMETABLE: "Exam timetable",
  INVIGILATION: "Invigilation roster",
  WEEKLY_DUTY: "Weekly duty roster",
};

/**
 * BUILD_PLAN.md §9 Step 6: the only frontend surface that calls
 * `POST /schedule-generation-requests` — before this, every trigger in this
 * session's testing was curl. Fields shown are conditional per scope, per
 * `ScheduleGenerationRequestService.create`'s scope-specific validation
 * (schedule-generation-request.ts): CLASS_TIMETABLE/WEEKLY_DUTY need
 * `termId`; EXAM_TIMETABLE/INVIGILATION need `assessmentComponentId` (and
 * EXAM_TIMETABLE additionally needs `parameters.examStartDate/examEndDate`).
 * `classArmId`/`classLevelCategoryGroup` are always optional (whole-scope
 * run vs. a narrower single-arm/single-group regeneration).
 */
export function TriggerGenerationForm({ onTriggered }: { onTriggered: () => void }) {
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [components, setComponents] = useState<AssessmentComponentOption[]>([]);

  const [scope, setScope] = useState<Scope>("CLASS_TIMETABLE");
  const [termId, setTermId] = useState("");
  const [classArmId, setClassArmId] = useState("");
  const [assessmentComponentId, setAssessmentComponentId] = useState("");
  const [classLevelCategoryGroup, setClassLevelCategoryGroup] = useState("");
  const [examStartDate, setExamStartDate] = useState("");
  const [examEndDate, setExamEndDate] = useState("");
  const [includeNonTeachingStaff, setIncludeNonTeachingStaff] = useState(false);
  const [teachersPerWeek, setTeachersPerWeek] = useState("");
  const [invigilatorsPerDay, setInvigilatorsPerDay] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<{ id: string; status: string }[]>([]);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<AssessmentComponentOption[]>("/assessment-components", { auth: true })
      .then((all) => setComponents(all.filter((c) => c.type === "MID_TERM" || c.type === "EXAM")))
      .catch(() => setComponents([]));
  }, []);

  // The Term select doubles as a filter for the assessment-component list
  // below it (EXAM_TIMETABLE/INVIGILATION) — components aren't otherwise
  // distinguishable by name alone (e.g. every term has its own "Exam"
  // component). Clear a stale selection whenever the term filter changes.
  useEffect(() => {
    setAssessmentComponentId("");
  }, [termId]);

  // Creche has no subjects (CLAUDE.md), so it's never a valid generation
  // target — filtered out of every picker below rather than just left to
  // produce an empty/no-op run.
  const componentsForTerm = (termId ? components.filter((c) => c.termId === termId) : components).filter(
    (c) => c.classLevelCategory !== "CRECHE",
  );

  // One option per displayed sitting (examArrangementFor's displayCategories
  // — JSS + SSS, Nursery + Primary). Most are one generation run; Nursery +
  // Primary's exam is two (Basic's mixed hall, Reception/Nursery per arm), so
  // `runs` holds one entry per generation sitting and submitting posts one
  // request per run — narrowed to the run covering the picked class arm, if any.
  const componentOptions = groupComponentsBySitting(componentsForTerm);
  const selectedOption = componentOptions.find((o) => o.id === assessmentComponentId);
  const selectedArmCategory = classArms.find((arm) => arm.id === classArmId)?.classLevel.category;
  const runs = (selectedOption?.generationIds ?? [])
    .map((id) => components.find((c) => c.id === id))
    .filter((c): c is AssessmentComponentOption => c !== undefined)
    .map((c) => ({ componentId: c.id, arrangement: examArrangementFor(c.classLevelCategory, c.type === "MID_TERM" ? "MID_TERM" : "EXAM") }))
    .filter((run) => !selectedArmCategory || run.arrangement.sittingCategories.includes(selectedArmCategory));
  const hasHallRun = runs.some((run) => run.arrangement.invigilation === "HALL_POOL_PER_DAY");
  const hasOpenPoolRun = runs.some((run) => run.arrangement.invigilation !== "CLASS_TEACHER" && !run.arrangement.poolClassTeachersOnly);

  // Once a class level group is picked for CLASS_TIMETABLE, the class arm
  // list below it narrows to that group's arms only — picking a group and
  // then an arm outside it made no sense (the arm select showed every arm
  // regardless of the group filter above it).
  const classArmsForGroup = (
    scope === "CLASS_TIMETABLE" && classLevelCategoryGroup
      ? classArms.filter((arm) => categoryToGroup(arm.classLevel.category) === classLevelCategoryGroup)
      : classArms
  ).filter((arm) => arm.classLevel.category !== "CRECHE");

  // Clear a class arm selection that's no longer in the narrowed list when
  // the group filter changes — otherwise a stale, now-hidden arm could
  // still be submitted.
  useEffect(() => {
    setClassArmId((current) => (current && !classArmsForGroup.some((arm) => arm.id === current) ? "" : current));
  }, [classLevelCategoryGroup]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastResults([]);
    setSubmitting(true);
    try {
      const parameters: Record<string, unknown> = {};
      if (scope === "EXAM_TIMETABLE") {
        parameters.examStartDate = examStartDate;
        parameters.examEndDate = examEndDate;
      }
      if (scope === "INVIGILATION" && includeNonTeachingStaff) {
        parameters.includeNonTeachingStaff = true;
      }
      if (scope === "INVIGILATION" && hasHallRun && invigilatorsPerDay.trim()) {
        parameters.invigilatorsPerDay = Number(invigilatorsPerDay);
      }
      if (scope === "WEEKLY_DUTY" && teachersPerWeek.trim()) {
        parameters.teachersPerWeek = Number(teachersPerWeek);
      }

      const body: Record<string, unknown> = { scope };
      if (scope === "CLASS_TIMETABLE" || scope === "WEEKLY_DUTY") body.termId = termId || undefined;
      if (scope !== "WEEKLY_DUTY") body.classArmId = classArmId || undefined;
      if ((scope === "WEEKLY_DUTY" || scope === "CLASS_TIMETABLE") && classLevelCategoryGroup) {
        body.classLevelCategoryGroup = classLevelCategoryGroup;
      }
      if (Object.keys(parameters).length > 0) body.parameters = parameters;

      const isExamScope = scope === "EXAM_TIMETABLE" || scope === "INVIGILATION";
      const bodies =
        isExamScope && runs.length > 0
          ? runs.map((run) => ({ ...body, assessmentComponentId: run.componentId }))
          : [{ ...body, ...(isExamScope ? { assessmentComponentId: assessmentComponentId || undefined } : {}) }];
      const results: { id: string; status: string }[] = [];
      try {
        for (const runBody of bodies) {
          results.push(
            await apiFetch<{ id: string; status: string }>("/schedule-generation-requests", { method: "POST", auth: true, body: runBody }),
          );
        }
      } finally {
        // A later run failing still leaves the earlier ones started — show those.
        setLastResults(results);
        if (results.length > 0) onTriggered();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to trigger generation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="trigger-scope">Scope</Label>
        <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
          <SelectTrigger id="trigger-scope" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SCOPE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="trigger-term">
          Term{(scope === "EXAM_TIMETABLE" || scope === "INVIGILATION") && " (filters the component list below)"}
        </Label>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger id="trigger-term" className="mt-1">
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

      {(scope === "EXAM_TIMETABLE" || scope === "INVIGILATION") && (
        <div>
          <Label htmlFor="trigger-component">Assessment component</Label>
          <Select value={assessmentComponentId} onValueChange={setAssessmentComponentId}>
            <SelectTrigger id="trigger-component" className="mt-1">
              <SelectValue placeholder={termId ? "Select a component for this term" : "Select a term first"} />
            </SelectTrigger>
            <SelectContent>
              {componentOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {runs.map((run) => (
            <p key={run.componentId} className="mt-1 text-[11.5px] text-muted">
              {describeArrangement(run.arrangement, scope)}
            </p>
          ))}
        </div>
      )}

      {scope === "WEEKLY_DUTY" && (
        <div>
          <Label htmlFor="trigger-group">Class level group (optional — omit for a combined run)</Label>
          <Select value={classLevelCategoryGroup} onValueChange={setClassLevelCategoryGroup}>
            <SelectTrigger id="trigger-group" className="mt-1">
              <SelectValue placeholder="Both groups (default)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="JSS_SSS">JSS / SSS</SelectItem>
              <SelectItem value="CRECHE_NURSERY_PRIMARY">Creche / Reception / Nursery / Primary</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {scope === "CLASS_TIMETABLE" && (
        <div>
          <Label htmlFor="trigger-timetable-group">
            Class level group (optional — narrows a whole-scope run to one group, and the class arm list below to that group)
          </Label>
          <Select value={classLevelCategoryGroup} onValueChange={setClassLevelCategoryGroup}>
            <SelectTrigger id="trigger-timetable-group" className="mt-1">
              <SelectValue placeholder="Whole scope (default)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="JSS_SSS">JSS / SSS</SelectItem>
              <SelectItem value="CRECHE_NURSERY_PRIMARY">Creche / Reception / Nursery / Primary</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {scope !== "WEEKLY_DUTY" && (
        <div>
          <Label htmlFor="trigger-class-arm">Class arm (optional — single-arm regeneration)</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="trigger-class-arm" className="mt-1">
              <SelectValue placeholder="Whole scope (default)" />
            </SelectTrigger>
            <SelectContent>
              {classArmsForGroup.map((arm) => (
                <SelectItem key={arm.id} value={arm.id}>
                  {arm.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {scope === "EXAM_TIMETABLE" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="trigger-exam-start">Exam start date</Label>
            <Input id="trigger-exam-start" type="date" value={examStartDate} onChange={(e) => setExamStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="trigger-exam-end">Exam end date</Label>
            <Input id="trigger-exam-end" type="date" value={examEndDate} onChange={(e) => setExamEndDate(e.target.value)} />
          </div>
        </div>
      )}

      {scope === "INVIGILATION" && hasHallRun && (
        <div>
          <Label htmlFor="trigger-invigilators-per-day">Invigilators per day (optional — uses the configured default)</Label>
          <Input
            id="trigger-invigilators-per-day"
            type="number"
            min={1}
            value={invigilatorsPerDay}
            onChange={(e) => setInvigilatorsPerDay(e.target.value)}
          />
        </div>
      )}

      {scope === "INVIGILATION" && hasOpenPoolRun && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <Checkbox checked={includeNonTeachingStaff} onCheckedChange={(c) => setIncludeNonTeachingStaff(c === true)} />
          Include non-teaching staff in the eligible pool
        </label>
      )}

      {scope === "WEEKLY_DUTY" && (
        <div>
          <Label htmlFor="trigger-teachers-per-week">Teachers per week (optional — uses the configured default)</Label>
          <Input
            id="trigger-teachers-per-week"
            type="number"
            min={1}
            value={teachersPerWeek}
            onChange={(e) => setTeachersPerWeek(e.target.value)}
          />
        </div>
      )}

      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {lastResults.map((result) => (
        <p key={result.id} className="text-[12.5px] text-muted">
          Request <span className="font-mono">{result.id.slice(0, 8)}</span> created —{" "}
          <Badge variant="warning">{result.status}</Badge>
        </p>
      ))}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Starting…" : "Start generation"}
      </Button>
    </form>
  );
}
