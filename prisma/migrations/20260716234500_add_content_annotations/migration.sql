CREATE TABLE "content_annotations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "thread_id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "card_revision" TEXT NOT NULL,
  "anchor_json" TEXT NOT NULL,
  "anchor_resolution" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "context_hash" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "lifecycle" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  "deleted_at" BIGINT,
  CONSTRAINT "content_annotations_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_content_annotations_thread_updated_at"
  ON "content_annotations"("thread_id", "updated_at");
CREATE INDEX "idx_content_annotations_card_updated_at"
  ON "content_annotations"("card_id", "updated_at");
