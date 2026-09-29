-- Seed the three Homework NotificationTemplate rows for deployments that
-- already ran `pnpm setup:school` before these NotificationType values
-- existed (setup-school's own upsert covers fresh installs; ON CONFLICT
-- keeps this a no-op there). Separate from the enum-adding migration since
-- Postgres can't use a newly added enum value in the same transaction.
-- Copy mirrors DEFAULT_NOTIFICATION_TEMPLATES in packages/types/src/notifications.ts.
INSERT INTO "notification_templates" ("id", "key", "channel", "subject", "bodyTemplate", "isCritical", "isCustomized", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'HOMEWORK_ASSIGNED', 'IN_APP', 'New assignment: {{subjectName}}', '{{studentName}} has a new {{subjectName}} assignment, "{{homeworkTitle}}", due {{dueDate}}.', false, false, NOW(), NOW()),
  (gen_random_uuid()::text, 'HOMEWORK_SUBMITTED', 'IN_APP', 'Assignment submitted', '{{studentName}} submitted "{{homeworkTitle}}" ({{subjectName}}, {{classArmName}}).', false, false, NOW(), NOW()),
  (gen_random_uuid()::text, 'HOMEWORK_MARKED', 'IN_APP', 'Assignment marked: {{subjectName}}', '{{studentName}}''s {{subjectName}} assignment "{{homeworkTitle}}" has been marked{{scoreText}}.', false, false, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
