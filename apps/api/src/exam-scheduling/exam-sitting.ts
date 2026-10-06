import { Prisma } from "@prisma/client";
import { examArrangementFor, type ExamArrangement, type ExamComponentType } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The AssessmentComponents generated and shown together as ONE exam sitting
 * with `assessmentComponentId` (examArrangementFor in packages/types) — e.g.
 * JSS's MID_TERM component and SSS's MID_TERM component of the same term and
 * sequence. Always includes the component itself; a CA component (never an
 * exam sitting) resolves to just itself. Same derivation as apps/worker's
 * SchedulingSolveDispatchProcessor.resolveSittingComponents.
 */
export async function resolveSitting(
  client: PrismaService | Prisma.TransactionClient,
  assessmentComponentId: string,
): Promise<{ arrangement: ExamArrangement | null; componentIds: string[] }> {
  const component = await client.assessmentComponent.findUniqueOrThrow({ where: { id: assessmentComponentId } });
  if (component.type !== "MID_TERM" && component.type !== "EXAM") {
    return { arrangement: null, componentIds: [component.id] };
  }
  const arrangement = examArrangementFor(component.classLevelCategory, component.type as ExamComponentType);
  const siblings = await client.assessmentComponent.findMany({
    where: {
      termId: component.termId,
      type: component.type,
      sequence: component.sequence,
      classLevelCategory: { in: arrangement.sittingCategories },
    },
    select: { id: true },
  });
  return { arrangement, componentIds: siblings.map((s) => s.id) };
}
