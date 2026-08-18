-- CreateTable
CREATE TABLE "class_subject_child_periods" (
    "id" TEXT NOT NULL,
    "classSubjectId" TEXT NOT NULL,
    "childSubjectId" TEXT NOT NULL,
    "periodsPerWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_subject_child_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_subject_child_periods_classSubjectId_childSubjectId_key" ON "class_subject_child_periods"("classSubjectId", "childSubjectId");

-- AddForeignKey
ALTER TABLE "class_subject_child_periods" ADD CONSTRAINT "class_subject_child_periods_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "class_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_child_periods" ADD CONSTRAINT "class_subject_child_periods_childSubjectId_fkey" FOREIGN KEY ("childSubjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
