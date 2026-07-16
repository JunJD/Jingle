CREATE TABLE "assistant_content_projections" (
  "thread_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "content_revision" TEXT NOT NULL,
  "finalized_at" BIGINT NOT NULL,
  PRIMARY KEY ("thread_id", "message_id"),
  CONSTRAINT "assistant_content_projections_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "assistant_content_parts" (
  "part_id" TEXT NOT NULL PRIMARY KEY,
  "thread_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  CONSTRAINT "assistant_content_parts_projection_fkey"
    FOREIGN KEY ("thread_id", "message_id")
    REFERENCES "assistant_content_projections" ("thread_id", "message_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_assistant_content_projections_thread_finalized"
  ON "assistant_content_projections"("thread_id", "finalized_at");
CREATE UNIQUE INDEX "uidx_assistant_content_parts_message_ordinal"
  ON "assistant_content_parts"("thread_id", "message_id", "ordinal");
CREATE INDEX "idx_assistant_content_parts_message"
  ON "assistant_content_parts"("thread_id", "message_id");
