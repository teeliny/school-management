-- CreateTable
CREATE TABLE "student_subject_exemptions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_subject_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_subject_exemptions_studentId_subjectId_key" ON "student_subject_exemptions"("studentId", "subjectId");

-- AddForeignKey
ALTER TABLE "student_subject_exemptions" ADD CONSTRAINT "student_subject_exemptions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subject_exemptions" ADD CONSTRAINT "student_subject_exemptions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
