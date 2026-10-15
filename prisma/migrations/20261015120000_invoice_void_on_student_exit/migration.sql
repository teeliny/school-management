-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "inactiveSince" TIMESTAMP(3);

-- Backfill inactiveSince for students already out of ACTIVE: the most
-- recent audited status change, falling back to updatedAt when no audit
-- row records it (e.g. a status set by a script rather than the API).
UPDATE "student_profiles" s
SET "inactiveSince" = COALESCE(
  (
    SELECT MAX(a."createdAt")
    FROM "audit_logs" a
    WHERE a."entityType" = 'StudentProfile'
      AND a."entityId" = s."id"
      AND a."after"->>'status' IS DISTINCT FROM a."before"->>'status'
      AND a."after"->>'status' IS NOT NULL
      AND a."after"->>'status' <> 'ACTIVE'
  ),
  s."updatedAt"
)
WHERE s."status" <> 'ACTIVE';

-- Backfill: students already out of ACTIVE before this column existed get
-- their not-yet-PAID invoices voided now, same rule StudentService.update
-- applies going forward.
UPDATE "invoices" i
SET "voidedAt" = NOW(),
    "voidReason" = 'Student ' || LOWER(s."status"::text)
FROM "student_profiles" s
WHERE i."studentId" = s."id"
  AND s."status" <> 'ACTIVE'
  AND i."status" <> 'PAID';
