CREATE TABLE "checkpoint_blobs" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT,
    PRIMARY KEY ("thread_id", "checkpoint_ns", "channel", "version"),
    CONSTRAINT "checkpoint_blobs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_checkpoint_blobs_thread_ns" ON "checkpoint_blobs"("thread_id", "checkpoint_ns");
