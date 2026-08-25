-- Captures schema drift that was applied directly to the dev database
-- outside of migration history (fee_structure_class_levels and
-- fee_structure_student_assignments already existed live, with
-- fee_structures.classLevelId already dropped, before this migration file
-- was written). This file makes migration history match that reality so
-- `prisma migrate dev`/`deploy` work again; it is marked as already-applied
-- via `prisma migrate resolve --applied` on the dev database rather than run
-- against it, but a fresh environment applying migrations from scratch runs
-- this SQL for real.

-- AlterTable: fee_structures loses its single-class-level column in favor of
-- the many-to-many join table below.
ALTER TABLE "fee_structures" DROP CONSTRAINT "fee_structures_classLevelId_fkey";
ALTER TABLE "fee_structures" DROP COLUMN "classLevelId";

-- CreateTable
CREATE TABLE "fee_structure_class_levels" (
    "feeStructureId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,

    CONSTRAINT "fee_structure_class_levels_pkey" PRIMARY KEY ("feeStructureId","classLevelId")
);

-- CreateTable
CREATE TABLE "fee_structure_student_assignments" (
    "id" TEXT NOT NULL,
    "feeStructureId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_structure_student_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_student_assignments_feeStructureId_studentId_key" ON "fee_structure_student_assignments"("feeStructureId", "studentId");

-- AddForeignKey
ALTER TABLE "fee_structure_class_levels" ADD CONSTRAINT "fee_structure_class_levels_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_class_levels" ADD CONSTRAINT "fee_structure_class_levels_classLevelId_fkey" FOREIGN KEY ("classLevelId") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_student_assignments" ADD CONSTRAINT "fee_structure_student_assignments_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_student_assignments" ADD CONSTRAINT "fee_structure_student_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
