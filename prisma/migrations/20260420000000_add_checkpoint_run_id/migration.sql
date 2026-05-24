ALTER TABLE "checkpoints" ADD COLUMN "run_id" TEXT;

CREATE INDEX "idx_checkpoints_thread_run_ns_checkpoint_id"
ON "checkpoints"("thread_id", "run_id", "checkpoint_ns", "checkpoint_id");
