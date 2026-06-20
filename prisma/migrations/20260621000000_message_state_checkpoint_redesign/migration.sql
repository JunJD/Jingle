-- Redesign message state storage.
-- This migration intentionally does not preserve legacy projected messages or
-- checkpoint message blobs. Message history is owned by the new message event
-- and state-version system from this point forward.

DROP TABLE IF EXISTS "messages_fts";
DROP TABLE IF EXISTS "messages_fts_trigram";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "message_events";
DROP TABLE IF EXISTS "message_state_versions";

CREATE TABLE "messages" (
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "raw_message" TEXT NOT NULL,
    "raw_hash" TEXT NOT NULL,
    "tool_calls" TEXT,
    "tool_call_id" TEXT,
    "name" TEXT,
    "metadata" TEXT,
    "run_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "search_text" TEXT NOT NULL,

    PRIMARY KEY ("thread_id", "message_id"),
    CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_messages_thread_seq" ON "messages"("thread_id", "seq");
CREATE INDEX "idx_messages_thread_created_at" ON "messages"("thread_id", "created_at");
CREATE INDEX "idx_messages_run_id" ON "messages"("run_id");

CREATE TABLE "message_events" (
    "event_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "message_id" TEXT,
    "run_id" TEXT,
    "checkpoint_id" TEXT,
    "payload" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "message_events_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_message_events_thread_ns_seq" ON "message_events"("thread_id", "checkpoint_ns", "seq");
CREATE INDEX "idx_message_events_checkpoint" ON "message_events"("thread_id", "checkpoint_ns", "checkpoint_id");
CREATE INDEX "idx_message_events_thread_run_seq" ON "message_events"("thread_id", "run_id", "seq");

CREATE TABLE "message_state_versions" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL,
    "through_seq" INTEGER NOT NULL,
    "state_hash" TEXT,
    "created_at" BIGINT NOT NULL,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "version"),
    CONSTRAINT "message_state_versions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_message_state_versions_thread_ns_seq" ON "message_state_versions"("thread_id", "checkpoint_ns", "through_seq");

CREATE VIRTUAL TABLE "messages_fts" USING fts5(
    "thread_id" UNINDEXED,
    "message_id" UNINDEXED,
    "role" UNINDEXED,
    "search_text",
    tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE "messages_fts_trigram" USING fts5(
    "thread_id" UNINDEXED,
    "message_id" UNINDEXED,
    "role" UNINDEXED,
    "search_text",
    tokenize = 'trigram'
);

DELETE FROM "checkpoint_blobs" WHERE "channel" = 'messages';
