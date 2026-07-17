CREATE TABLE "assistant_content_projection_jobs" (
  "run_id" TEXT NOT NULL PRIMARY KEY,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "assistant_content_projection_jobs_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_assistant_content_projection_jobs_status_run_id"
  ON "assistant_content_projection_jobs"("status", "run_id");

CREATE TABLE "assistant_content_projection_blocked_inputs" (
  "run_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "source_revision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "message_id"),
  CONSTRAINT "assistant_content_projection_blocked_inputs_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "assistant_content_projection_jobs" ("run_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
