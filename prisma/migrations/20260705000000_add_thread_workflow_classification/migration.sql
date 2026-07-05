CREATE TABLE "workflow_statuses" (
  "status_id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "color_json" TEXT,
  "icon" TEXT,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "is_fixed" BOOLEAN NOT NULL DEFAULT false,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "workflow_statuses_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_workflow_statuses_project_key" ON "workflow_statuses"("project_id", "key");
CREATE INDEX "idx_workflow_statuses_project_category_order" ON "workflow_statuses"("project_id", "category", "order_index");

CREATE TABLE "workflow_labels" (
  "label_id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "parent_label_id" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color_json" TEXT,
  "value_type" TEXT NOT NULL DEFAULT 'boolean',
  "auto_rules_json" TEXT,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "workflow_labels_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_labels_parent_label_id_fkey"
    FOREIGN KEY ("parent_label_id") REFERENCES "workflow_labels"("label_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_workflow_labels_project_key" ON "workflow_labels"("project_id", "key");
CREATE INDEX "idx_workflow_labels_project_parent_order" ON "workflow_labels"("project_id", "parent_label_id", "order_index");

CREATE TABLE "thread_workflows" (
  "thread_id" TEXT NOT NULL PRIMARY KEY,
  "status_id" TEXT,
  "primary_source_ref_json" TEXT,
  "current_gate" TEXT,
  "status_updated_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "thread_workflows_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "thread_workflows_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("status_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_thread_workflows_status_id" ON "thread_workflows"("status_id");
CREATE INDEX "idx_thread_workflows_current_gate_updated_at" ON "thread_workflows"("current_gate", "updated_at");

CREATE TABLE "thread_labels" (
  "thread_id" TEXT NOT NULL,
  "label_id" TEXT NOT NULL,
  "raw_value" TEXT NOT NULL DEFAULT '',
  "created_at" BIGINT NOT NULL,
  PRIMARY KEY ("thread_id", "label_id", "raw_value"),
  CONSTRAINT "thread_labels_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "thread_labels_label_id_fkey"
    FOREIGN KEY ("label_id") REFERENCES "workflow_labels"("label_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_thread_labels_label_value" ON "thread_labels"("label_id", "raw_value");
CREATE INDEX "idx_thread_labels_thread_created_at" ON "thread_labels"("thread_id", "created_at");

CREATE TABLE "thread_spawn_edges" (
  "parent_thread_id" TEXT NOT NULL,
  "child_thread_id" TEXT NOT NULL,
  "role" TEXT,
  "edge_status" TEXT NOT NULL DEFAULT 'open',
  "metadata" TEXT,
  "created_at" BIGINT NOT NULL,
  "closed_at" BIGINT,
  PRIMARY KEY ("parent_thread_id", "child_thread_id"),
  CONSTRAINT "thread_spawn_edges_parent_thread_id_fkey"
    FOREIGN KEY ("parent_thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "thread_spawn_edges_child_thread_id_fkey"
    FOREIGN KEY ("child_thread_id") REFERENCES "threads"("thread_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uidx_thread_spawn_edges_child_thread_id" ON "thread_spawn_edges"("child_thread_id");
CREATE INDEX "idx_thread_spawn_edges_parent_status" ON "thread_spawn_edges"("parent_thread_id", "edge_status");
CREATE INDEX "idx_thread_spawn_edges_status_created_at" ON "thread_spawn_edges"("edge_status", "created_at");
