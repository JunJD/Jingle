ALTER TABLE "threads" ADD COLUMN "archived_at" BIGINT;

CREATE INDEX "idx_threads_archived_at_updated_at" ON "threads"("archived_at", "updated_at");
