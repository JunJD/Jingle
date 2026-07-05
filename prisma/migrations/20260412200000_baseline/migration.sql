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
CREATE TABLE "hitl_requests" (
    "request_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "tool_call_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_args" TEXT NOT NULL,
    "review_kind" TEXT,
    "review_payload" TEXT,
    "allowed_decisions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "resolved_at" BIGINT,
    CONSTRAINT "hitl_requests_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hitl_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "artifact_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "message_id" TEXT,
    "tool_call_id" TEXT,
    "artifact_key" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "source_type" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" BIGINT,
    "source_uri" TEXT,
    "preview_text" TEXT,
    "payload_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "artifacts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifact_presentations" (
    "presentation_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "artifact_ids_json" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "artifact_presentations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
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

-- CreateTable
CREATE VIRTUAL TABLE "messages_fts" USING fts5(
    "thread_id" UNINDEXED,
    "message_id" UNINDEXED,
    "role" UNINDEXED,
    "search_text",
    tokenize = 'unicode61 remove_diacritics 2'
);

-- CreateIndex
CREATE INDEX "idx_threads_updated_at" ON "threads"("updated_at");

-- CreateIndex
CREATE INDEX "idx_runs_thread_id" ON "runs"("thread_id");

-- CreateIndex
CREATE INDEX "idx_runs_status" ON "runs"("status");

-- CreateIndex
CREATE INDEX "idx_session_bindings_workspace_key" ON "session_bindings"("workspace_key");

-- CreateIndex
CREATE INDEX "idx_session_bindings_thread_id" ON "session_bindings"("current_thread_id");

-- CreateIndex
CREATE INDEX "idx_hitl_requests_thread_status_updated_at" ON "hitl_requests"("thread_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "idx_hitl_requests_thread_updated_at" ON "hitl_requests"("thread_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_hitl_requests_run_id" ON "hitl_requests"("run_id");

-- CreateIndex
CREATE INDEX "idx_artifacts_thread_created_at" ON "artifacts"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_artifacts_thread_kind_created_at" ON "artifacts"("thread_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "idx_artifacts_run_id" ON "artifacts"("run_id");

-- CreateIndex
CREATE INDEX "idx_artifacts_message_id" ON "artifacts"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "uidx_artifacts_thread_dedupe_key" ON "artifacts"("thread_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "idx_artifact_presentations_thread_created_at" ON "artifact_presentations"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uidx_artifact_presentations_thread_idempotency" ON "artifact_presentations"("thread_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_checkpoints_thread_ns" ON "checkpoints"("thread_id", "checkpoint_ns");

-- CreateIndex
CREATE INDEX "idx_writes_thread_checkpoint" ON "writes"("thread_id", "checkpoint_ns", "checkpoint_id");
