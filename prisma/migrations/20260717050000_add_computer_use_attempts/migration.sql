CREATE TABLE "computer_use_attempts" (
  "attempt_id" TEXT NOT NULL PRIMARY KEY,
  "phase" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload_json" TEXT NOT NULL,
  CONSTRAINT "computer_use_attempts_phase_revision_check" CHECK (
    ("phase" = 'queued' AND "revision" = 0)
    OR ("phase" = 'dispatched' AND "revision" = 1)
    OR ("phase" = 'settled' AND "revision" IN (1, 2))
  ),
  CONSTRAINT "computer_use_attempts_payload_json_check" CHECK (json_valid("payload_json"))
);
