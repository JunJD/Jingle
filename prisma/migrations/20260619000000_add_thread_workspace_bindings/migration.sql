CREATE TABLE "projects" (
  "project_id" TEXT NOT NULL PRIMARY KEY,
  "workspace_key" TEXT NOT NULL,
  "canonical_workspace_path" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  "archived_at" BIGINT
);

CREATE UNIQUE INDEX "projects_workspace_key_key" ON "projects"("workspace_key");
CREATE INDEX "idx_projects_updated_at" ON "projects"("updated_at");

CREATE TABLE "thread_workspace_bindings" (
  "thread_id" TEXT NOT NULL PRIMARY KEY,
  "workspace_kind" TEXT NOT NULL,
  "project_id" TEXT,
  "workspace_key" TEXT,
  "workspace_path" TEXT,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "thread_workspace_bindings_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "thread_workspace_bindings_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_thread_workspace_bindings_kind" ON "thread_workspace_bindings"("workspace_kind");
CREATE INDEX "idx_thread_workspace_bindings_project_id" ON "thread_workspace_bindings"("project_id");
CREATE INDEX "idx_thread_workspace_bindings_workspace_key" ON "thread_workspace_bindings"("workspace_key");
