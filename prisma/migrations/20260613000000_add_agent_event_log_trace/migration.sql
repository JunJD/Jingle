CREATE TABLE "agent_event_sequences" (
    "aggregate_id" TEXT NOT NULL PRIMARY KEY,
    "aggregate_type" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "updated_at" BIGINT NOT NULL
);

CREATE TABLE "agent_events" (
    "event_id" TEXT NOT NULL PRIMARY KEY,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "checkpoint_id" TEXT,
    "trace_id" TEXT,
    "metadata" TEXT,
    CONSTRAINT "agent_events_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_agent_events_aggregate_seq" ON "agent_events"("aggregate_id", "seq");
CREATE INDEX "idx_agent_events_thread_run" ON "agent_events"("thread_id", "run_id");
CREATE INDEX "idx_agent_events_type" ON "agent_events"("type");
CREATE INDEX "idx_agent_events_trace_seq" ON "agent_events"("trace_id", "seq");

CREATE TABLE "agent_traces" (
    "trace_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "completion_reason" TEXT,
    "error_type" TEXT,
    "error_message" TEXT,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "total_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "projected_through_seq" INTEGER NOT NULL DEFAULT 0,
    "has_gap" BOOLEAN NOT NULL DEFAULT false,
    "projection_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "agent_traces_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_agent_traces_run_id" ON "agent_traces"("run_id");
CREATE INDEX "idx_agent_traces_thread_started_at" ON "agent_traces"("thread_id", "started_at");
CREATE INDEX "idx_agent_traces_status_updated_at" ON "agent_traces"("status", "updated_at");

CREATE TABLE "agent_trace_steps" (
    "trace_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "event_type" TEXT,
    "event_seq" INTEGER,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "duration_ms" INTEGER,
    "model" TEXT,
    "provider" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "tool_name" TEXT,
    "tool_call_id" TEXT,
    "input_blob_id" TEXT,
    "output_blob_id" TEXT,
    "context_blob_id" TEXT,
    "error_type" TEXT,
    "error_message" TEXT,
    "projected_through_seq" INTEGER NOT NULL,
    PRIMARY KEY ("trace_id", "step_index"),
    CONSTRAINT "agent_trace_steps_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "agent_traces" ("trace_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_agent_trace_steps_type_started_at" ON "agent_trace_steps"("trace_id", "step_type", "started_at");
CREATE INDEX "idx_agent_trace_steps_tool_call_id" ON "agent_trace_steps"("trace_id", "tool_call_id");

CREATE TABLE "agent_trace_blobs" (
    "blob_id" TEXT NOT NULL PRIMARY KEY,
    "trace_id" TEXT NOT NULL,
    "step_index" INTEGER,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "preview" TEXT,
    "value" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    CONSTRAINT "agent_trace_blobs_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "agent_traces" ("trace_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_trace_blobs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_agent_trace_blobs_trace_step" ON "agent_trace_blobs"("trace_id", "step_index");
CREATE INDEX "idx_agent_trace_blobs_trace_kind" ON "agent_trace_blobs"("trace_id", "kind");
CREATE INDEX "idx_agent_trace_blobs_sha256" ON "agent_trace_blobs"("sha256");
