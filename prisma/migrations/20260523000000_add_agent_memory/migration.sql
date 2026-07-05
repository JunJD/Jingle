CREATE TABLE "agent_memories" (
  "memory_id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "workspace_key" TEXT,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  "last_included_at" BIGINT,
  "metadata" TEXT
);

CREATE INDEX "idx_agent_memories_type_status_updated_at"
  ON "agent_memories"("type", "status", "updated_at");

CREATE INDEX "idx_agent_memories_scope_workspace_status_updated_at"
  ON "agent_memories"("scope", "workspace_key", "status", "updated_at");

CREATE TABLE "agent_memory_suggestions" (
  "suggestion_id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "workspace_key" TEXT,
  "content" TEXT NOT NULL,
  "reason" TEXT,
  "review_payload" TEXT,
  "decision" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "thread_id" TEXT,
  "source_run_id" TEXT,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  "resolved_at" BIGINT,
  CONSTRAINT "agent_memory_suggestions_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads"("thread_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_suggestions_source_run_id_fkey"
    FOREIGN KEY ("source_run_id") REFERENCES "runs"("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_agent_memory_suggestions_status_updated_at"
  ON "agent_memory_suggestions"("status", "updated_at");

CREATE INDEX "idx_agent_memory_suggestions_thread_status_updated_at"
  ON "agent_memory_suggestions"("thread_id", "status", "updated_at");

CREATE INDEX "idx_agent_memory_suggestions_scope_workspace_status_updated_at"
  ON "agent_memory_suggestions"("scope", "workspace_key", "status", "updated_at");

CREATE TABLE "agent_memory_inclusions" (
  "inclusion_id" TEXT NOT NULL PRIMARY KEY,
  "memory_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL,
  CONSTRAINT "agent_memory_inclusions_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "agent_memories"("memory_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_inclusions_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_inclusions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_agent_memory_inclusions_memory_run"
  ON "agent_memory_inclusions"("memory_id", "run_id");

CREATE INDEX "idx_agent_memory_inclusions_run_id"
  ON "agent_memory_inclusions"("run_id");

CREATE INDEX "idx_agent_memory_inclusions_thread_id_created_at"
  ON "agent_memory_inclusions"("thread_id", "created_at");
