-- CreateTable
CREATE TABLE "class_subject_level_statuses" (
    "id" TEXT NOT NULL,
    "classSubjectId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_subject_level_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_subject_level_statuses_classSubjectId_classLevelId_key" ON "class_subject_level_statuses"("classSubjectId", "classLevelId");

-- AddForeignKey
ALTER TABLE "class_subject_level_statuses" ADD CONSTRAINT "class_subject_level_statuses_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "class_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_level_statuses" ADD CONSTRAINT "class_subject_level_statuses_classLevelId_fkey" FOREIGN KEY ("classLevelId") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_level_statuses" ADD CONSTRAINT "class_subject_level_statuses_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
