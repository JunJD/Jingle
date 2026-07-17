ALTER TABLE "runtime_compaction_commits"
ADD COLUMN "model_selection_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "runtime_compaction_commits"
ADD COLUMN "thinking_effort" TEXT;
