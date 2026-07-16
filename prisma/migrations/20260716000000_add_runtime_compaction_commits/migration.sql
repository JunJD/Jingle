-- This ledger intentionally references the thread, not a checkpoint, so idempotency survives checkpoint retention.
CREATE TABLE "runtime_compaction_commits" (
    "thread_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "expected_checkpoint_id" TEXT NOT NULL,
    "compaction" TEXT NOT NULL,
    "message_count_after_compaction" INTEGER NOT NULL,
    "message_count_before_compaction" INTEGER NOT NULL,
    "model_id" TEXT NOT NULL,
    "preserve_last_user_message_count_present" BOOLEAN NOT NULL,
    "reason" TEXT,
    "requested_preserve_last_user_message_count" BIGINT,
    "trigger" TEXT NOT NULL,

    CONSTRAINT "runtime_compaction_commits_pkey" PRIMARY KEY ("thread_id", "operation_id"),
    CONSTRAINT "runtime_compaction_commits_trigger_check" CHECK ("trigger" = 'manual'),
    CONSTRAINT "runtime_compaction_commits_preserve_check" CHECK (
      ("preserve_last_user_message_count_present" = 0 AND "requested_preserve_last_user_message_count" IS NULL)
      OR
      (
        "preserve_last_user_message_count_present" = 1
        AND (
          "requested_preserve_last_user_message_count" IS NULL
          OR "requested_preserve_last_user_message_count" >= 0
        )
      )
    ),
    CONSTRAINT "runtime_compaction_commits_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id")
      ON DELETE CASCADE ON UPDATE CASCADE
);
