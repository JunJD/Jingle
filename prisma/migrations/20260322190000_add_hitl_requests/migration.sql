-- CreateTable
CREATE TABLE "hitl_requests" (
    "request_id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "tool_call_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_args" TEXT NOT NULL,
    "allowed_decisions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "resolved_at" BIGINT,
    CONSTRAINT "hitl_requests_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hitl_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("run_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_hitl_requests_thread_status_updated_at" ON "hitl_requests"("thread_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "idx_hitl_requests_thread_updated_at" ON "hitl_requests"("thread_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_hitl_requests_run_id" ON "hitl_requests"("run_id");
