-- CreateEnum
CREATE TYPE "AttendanceSessionType" AS ENUM ('STUDENT', 'STAFF');

-- CreateEnum
CREATE TYPE "AttendanceSessionKind" AS ENUM ('DAILY', 'PERIOD');

-- CreateEnum
CREATE TYPE "AttendancePersonType" AS ENUM ('STUDENT', 'STAFF');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AttendanceGranularity" AS ENUM ('DAILY', 'MORNING_AND_AFTERNOON');

-- AlterTable
ALTER TABLE "school_profiles" ADD COLUMN     "attendanceBackdateWindowDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "attendanceGranularity" "AttendanceGranularity" NOT NULL DEFAULT 'DAILY';

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "type" "AttendanceSessionType" NOT NULL,
    "kind" "AttendanceSessionKind" NOT NULL,
    "classArmId" TEXT,
    "date" DATE NOT NULL,
    "period" TEXT,
    "subjectId" TEXT,
    "takenByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "attendanceSessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "personType" "AttendancePersonType" NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_holidays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "academicSessionId" TEXT,
    "termId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_attendanceSessionId_personId_key" ON "attendance_records"("attendanceSessionId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "school_holidays_date_key" ON "school_holidays"("date");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_classArmId_fkey" FOREIGN KEY ("classArmId") REFERENCES "class_arms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_holidays" ADD CONSTRAINT "school_holidays_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_holidays" ADD CONSTRAINT "school_holidays_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
