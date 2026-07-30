DROP INDEX "idx_agent_memory_suggestions_thread_status_updated_at";

CREATE INDEX "idx_agent_memory_suggestions_thread_status_updated_at"
  ON "agent_memory_suggestions"("thread_id", "status", "updated_at", "scope");
