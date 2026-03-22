-- CreateTable
CREATE TABLE "threads" (
    "thread_id" TEXT NOT NULL PRIMARY KEY,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "thread_values" TEXT,
    "title" TEXT
);

-- CreateTable
CREATE TABLE "runs" (
    "run_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "assistant_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "status" TEXT,
    "metadata" TEXT,
    "kwargs" TEXT,
    CONSTRAINT "runs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants" ("assistant_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "message_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" TEXT,
    "tool_call_id" TEXT,
    "name" TEXT,
    "metadata" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assistants" (
    "assistant_id" TEXT NOT NULL PRIMARY KEY,
    "graph_id" TEXT NOT NULL,
    "name" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    "config" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "session_bindings" (
    "session_key" TEXT NOT NULL PRIMARY KEY,
    "workspace_key" TEXT NOT NULL,
    "workspace_path" TEXT NOT NULL,
    "current_thread_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "metadata" TEXT,
    CONSTRAINT "session_bindings_current_thread_id_fkey" FOREIGN KEY ("current_thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "parent_checkpoint_id" TEXT,
    "type" TEXT,
    "checkpoint" TEXT,
    "metadata" TEXT,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id"),
    CONSTRAINT "checkpoints_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "writes" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx"),
    CONSTRAINT "writes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_threads_updated_at" ON "threads"("updated_at");

-- CreateIndex
CREATE INDEX "idx_runs_thread_id" ON "runs"("thread_id");

-- CreateIndex
CREATE INDEX "idx_runs_status" ON "runs"("status");

-- CreateIndex
CREATE INDEX "idx_messages_thread_created_at" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_messages_run_id" ON "messages"("run_id");

-- CreateIndex
CREATE INDEX "idx_messages_tool_call_id" ON "messages"("tool_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_messages_thread_seq_unique" ON "messages"("thread_id", "seq");

-- CreateIndex
CREATE INDEX "idx_session_bindings_workspace_key" ON "session_bindings"("workspace_key");

-- CreateIndex
CREATE INDEX "idx_session_bindings_thread_id" ON "session_bindings"("current_thread_id");

-- CreateIndex
CREATE INDEX "idx_checkpoints_thread_ns" ON "checkpoints"("thread_id", "checkpoint_ns");

-- CreateIndex
CREATE INDEX "idx_writes_thread_checkpoint" ON "writes"("thread_id", "checkpoint_ns", "checkpoint_id");
