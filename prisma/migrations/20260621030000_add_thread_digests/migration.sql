CREATE TABLE "thread_digests" (
    "thread_id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "topics" TEXT,
    "decisions" TEXT,
    "open_questions" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "projected_through_seq" INTEGER NOT NULL DEFAULT 0,
    "source_hash" TEXT,
    "projection_error" TEXT,
    "generated_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "thread_digests_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_thread_digests_status_updated_at" ON "thread_digests"("status", "updated_at");

CREATE VIRTUAL TABLE "thread_digests_fts" USING fts5(
    "thread_id" UNINDEXED,
    "search_text",
    tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE "thread_digests_fts_trigram" USING fts5(
    "thread_id" UNINDEXED,
    "search_text",
    tokenize = 'trigram'
);
