CREATE TABLE "messages" (
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" TEXT,
    "tool_call_id" TEXT,
    "name" TEXT,
    "metadata" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "search_text" TEXT NOT NULL,
    PRIMARY KEY ("thread_id", "message_id"),
    CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_messages_thread_created_at" ON "messages"("thread_id", "created_at");

INSERT INTO "messages" ("thread_id", "message_id", "role", "kind", "content", "created_at", "updated_at", "search_text")
SELECT "thread_id", "message_id", "role", 'message', "search_text", strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, "search_text"
FROM "messages_fts";

DELETE FROM "messages_fts";
DELETE FROM "messages_fts_trigram";

INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
SELECT "thread_id", "message_id", "role", "search_text"
FROM "messages"
WHERE length("search_text") > 0;

INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
SELECT "thread_id", "message_id", "role", "search_text"
FROM "messages"
WHERE length("search_text") > 0;
