-- CreateTable
CREATE TABLE "class_subject_term_statuses" (
    "id" TEXT NOT NULL,
    "classSubjectId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_subject_term_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_subject_term_statuses_classSubjectId_subjectId_termId_key" ON "class_subject_term_statuses"("classSubjectId", "subjectId", "termId");

-- AddForeignKey
ALTER TABLE "class_subject_term_statuses" ADD CONSTRAINT "class_subject_term_statuses_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "class_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_term_statuses" ADD CONSTRAINT "class_subject_term_statuses_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_term_statuses" ADD CONSTRAINT "class_subject_term_statuses_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subject_term_statuses" ADD CONSTRAINT "class_subject_term_statuses_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
