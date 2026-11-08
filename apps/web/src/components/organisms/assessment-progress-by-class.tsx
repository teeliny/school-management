"use client";

import type { AssessmentProgressClass } from "@school/types";
import { classComplete, names, subjectComplete } from "../../lib/assessment-progress";
import { Card, CardHeader } from "../molecules/card";
import { AllCompleteState, ClassReportChips, StatusBadge, SubjectRow } from "../molecules/assessment-progress-chips";

export function AssessmentProgressByClass({ classes, incompleteOnly }: { classes: AssessmentProgressClass[]; incompleteOnly: boolean }) {
  const visible = incompleteOnly ? classes.filter((c) => !classComplete(c)) : classes;
  if (visible.length === 0) return <AllCompleteState />;
  return (
    <div className="space-y-4">
      {visible.map((cls) => {
        const subjects = incompleteOnly ? cls.subjects.filter((s) => !subjectComplete(s)) : cls.subjects;
        return (
          <Card key={cls.classArmId}>
            <CardHeader
              title={cls.className}
              sub={`Class teacher: ${names(cls.classTeachers, "Unassigned")} · ${cls.totalStudents} student${cls.totalStudents === 1 ? "" : "s"}`}
              action={<StatusBadge complete={classComplete(cls)} empty={cls.totalStudents === 0} />}
            />
            <ClassReportChips cls={cls} show={["classTeacher", "skills", "principal"]} />
            <div className="mt-3 space-y-2">
              {subjects.length === 0 ? (
                <p className="text-[12.5px] text-muted">
                  {cls.subjects.length === 0 ? "No subjects with enrolled students." : "Every subject is complete."}
                </p>
              ) : (
                subjects.map((s) => (
                  <SubjectRow
                    key={s.subjectId}
                    title={s.subjectName}
                    sub={`${names(s.teachers, "No subject teacher")} · ${s.total} enrolled`}
                    subject={s}
                  />
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
