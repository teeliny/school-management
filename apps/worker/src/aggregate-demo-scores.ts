import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { ClassLevelCategory } from "@prisma/client";
import { PrismaModule } from "./prisma/prisma.module";
import { PrismaService } from "./prisma/prisma.service";
import { SubjectTermResultModule } from "./subject-term-result/subject-term-result.module";
import { SubjectTermResultService } from "./subject-term-result/subject-term-result.service";

/**
 * One-shot companion to apps/api's seed-demo-data.ts: that script writes
 * ScoreEntry rows directly via ScoreEntryService.enter (admin override), which
 * — unlike the real class-teacher/subject-teacher entry path — never queues a
 * SubjectTermResult recompute. In real usage those rows only get aggregated
 * into SubjectTermResult (what Broadsheet, report cards, and the Principal
 * comment panel actually read) once the assessment-schedule-sweep notices
 * every AssessmentComponent in a (term, classLevelCategory) group has closed
 * — which never happens for freshly-seeded DRAFT components. This runs the
 * same aggregation (SubjectTermResultService.aggregateForClassCategoryTerm)
 * directly, for every term x category, without touching component status or
 * publishing anything.
 *
 * Bootstraps a minimal module (just Prisma + SubjectTermResult, not the full
 * worker AppModule) so this doesn't need AWS/email credentials the other
 * worker feature modules (StorageModule, EmailModule, ...) require.
 *
 * Safe to re-run: aggregateForClassCategoryTerm upserts.
 *
 * Usage: pnpm --filter=@school/worker run aggregate:demo-scores
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    PrismaModule,
    SubjectTermResultModule,
  ],
})
class AggregateDemoScoresModule {}

async function main() {
  const logger = new Logger("aggregate:demo-scores");
  const app = await NestFactory.createApplicationContext(AggregateDemoScoresModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const subjectTermResults = app.get(SubjectTermResultService);

  try {
    const terms = await prisma.term.findMany();
    for (const term of terms) {
      for (const category of [ClassLevelCategory.JSS, ClassLevelCategory.SSS]) {
        await subjectTermResults.aggregateForClassCategoryTerm(term.id, category);
        logger.log(`Aggregated ${term.name} / ${category}.`);
      }
    }
    logger.log(`Done — SubjectTermResult aggregated for ${terms.length} terms x 2 class groups.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
