-- Venue (e.g. "Hall", "Classroom 3") an exam-day invigilator is posted to; null = no venues configured.
ALTER TABLE "exam_day_invigilations" ADD COLUMN "venue" TEXT;
