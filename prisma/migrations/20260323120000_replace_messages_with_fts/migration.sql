DROP TABLE IF EXISTS "messages_fts";
DROP TABLE IF EXISTS "messages";

CREATE VIRTUAL TABLE "messages_fts" USING fts5(
    "thread_id" UNINDEXED,
    "message_id" UNINDEXED,
    "role" UNINDEXED,
    "search_text",
    tokenize = 'unicode61 remove_diacritics 2'
);
