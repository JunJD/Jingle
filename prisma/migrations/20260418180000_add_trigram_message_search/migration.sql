CREATE VIRTUAL TABLE "messages_fts_trigram" USING fts5(
    "thread_id" UNINDEXED,
    "message_id" UNINDEXED,
    "role" UNINDEXED,
    "search_text",
    tokenize = 'trigram'
);

INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
SELECT "thread_id", "message_id", "role", "search_text"
FROM "messages_fts";
