ALTER TABLE "assistant_content_projection_jobs"
  ADD COLUMN "failure_code" TEXT;

ALTER TABLE "assistant_content_projection_jobs"
  ADD COLUMN "next_attempt_at" BIGINT;

-- Old failures did not carry a typed retry classification. Preserve their diagnostics but fail
-- closed instead of granting an unbounded retry lease after this migration.
UPDATE "assistant_content_projection_jobs"
SET "status" = 'parked', "failure_code" = 'unexpected', "next_attempt_at" = NULL
WHERE "status" = 'failed';

CREATE INDEX "idx_assistant_content_projection_jobs_retry_due"
  ON "assistant_content_projection_jobs"("status", "next_attempt_at", "run_id");
