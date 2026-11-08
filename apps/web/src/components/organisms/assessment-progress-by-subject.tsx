"use client";

import { useMemo } from "react";
import type { AssessmentProgressClass } from "@school/types";
import { names, subjectComplete } from "../../lib/assessment-progress";
import { Card, CardHeader } from "../molecules/card";
import { AllCompleteState, StatusBadge, SubjectRow } from "../molecules/assessment-progress-chips";

export function AssessmentProgressBySubject({ classes, incompleteOnly }: { classes: AssessmentProgressClass[]; incompleteOnly: boolean }) {
  const bySubject = useMemo(() => {
    const map = new Map<string, { subjectName: string; rows: { cls: AssessmentProgressClass; subject: AssessmentProgressClass["subjects"][number] }[] }>();
    for (const cls of classes) {
      for (const subject of cls.subjects) {
        const entry = map.get(subject.subjectName) ?? { subjectName: subject.subjectName, rows: [] };
        entry.rows.push({ cls, subject });
        map.set(subject.subjectName, entry);
      }
    }
    return [...map.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [classes]);

  const visible = bySubject
    .map((g) => ({ ...g, rows: incompleteOnly ? g.rows.filter((r) => !subjectComplete(r.subject)) : g.rows }))
    .filter((g) => g.rows.length > 0);
  if (visible.length === 0) return <AllCompleteState />;

  return (
    <div className="space-y-4">
      {visible.map((group) => {
        const done = group.rows.filter((r) => subjectComplete(r.subject)).length;
        return (
          <Card key={group.subjectName}>
            <CardHeader
              title={group.subjectName}
              sub={`${done} of ${group.rows.length} class${group.rows.length === 1 ? "" : "es"} complete`}
              action={<StatusBadge complete={done === group.rows.length} />}
            />
            <div className="space-y-2">
              {group.rows.map(({ cls, subject }) => (
                <SubjectRow
                  key={`${cls.classArmId}-${subject.subjectId}`}
                  title={cls.className}
                  sub={`${names(subject.teachers, "No subject teacher")} · ${subject.total} enrolled`}
                  subject={subject}
                />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
