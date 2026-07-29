CREATE TABLE "assistant_content_projection_blocked_inputs_next" (
  "run_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "source_revision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "message_id"),
  CONSTRAINT "assistant_content_projection_blocked_inputs_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "assistant_content_projection_jobs" ("run_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "assistant_content_projection_blocked_inputs_next" (
  "run_id", "message_id", "source_revision", "reason", "detail"
)
SELECT
  "run_id",
  "message_id",
  "source_revision",
  "reason",
  CASE "reason"
    WHEN 'invalid-json'
      THEN 'Assistant content projection rejected invalid-json persisted content.'
    WHEN 'noncanonical'
      THEN 'Assistant content projection rejected noncanonical persisted content.'
    ELSE 'Assistant content projection rejected persisted content.'
  END
FROM "assistant_content_projection_blocked_inputs";

DROP TABLE "assistant_content_projection_blocked_inputs";
ALTER TABLE "assistant_content_projection_blocked_inputs_next"
  RENAME TO "assistant_content_projection_blocked_inputs";

UPDATE "assistant_content_projection_jobs"
SET "last_error" = NULL
WHERE "status" = 'blocked';
