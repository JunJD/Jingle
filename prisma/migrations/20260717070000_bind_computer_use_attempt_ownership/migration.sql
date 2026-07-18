CREATE UNIQUE INDEX "uidx_runs_run_id_thread_id" ON "runs"("run_id", "thread_id");

CREATE TABLE "computer_use_attempts_migration_guard" (
  "valid" INTEGER NOT NULL,
  CONSTRAINT "computer_use_attempts_migration_guard_check" CHECK ("valid" = 1)
);

INSERT INTO "computer_use_attempts_migration_guard" ("valid")
SELECT CASE
  WHEN json_type("attempts"."payload_json", '$.attemptId') = 'text'
    AND json_extract("attempts"."payload_json", '$.attemptId') = "attempts"."attempt_id"
    AND length(trim(
      json_extract("attempts"."payload_json", '$.attemptId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )) > 0
    AND json_extract("attempts"."payload_json", '$.attemptId') = trim(
      json_extract("attempts"."payload_json", '$.attemptId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )
    AND json_type("attempts"."payload_json", '$.phase') = 'text'
    AND json_extract("attempts"."payload_json", '$.phase') = "attempts"."phase"
    AND json_type("attempts"."payload_json", '$.revision') = 'integer'
    AND json_extract("attempts"."payload_json", '$.revision') = "attempts"."revision"
    AND json_type("attempts"."payload_json", '$.authorization.runId') = 'text'
    AND json_type("attempts"."payload_json", '$.authorization.threadId') = 'text'
    AND length(trim(
      json_extract("attempts"."payload_json", '$.authorization.runId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )) > 0
    AND json_extract("attempts"."payload_json", '$.authorization.runId') = trim(
      json_extract("attempts"."payload_json", '$.authorization.runId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )
    AND length(trim(
      json_extract("attempts"."payload_json", '$.authorization.threadId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )) > 0
    AND json_extract("attempts"."payload_json", '$.authorization.threadId') = trim(
      json_extract("attempts"."payload_json", '$.authorization.threadId'),
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    )
  THEN CASE
    WHEN "owners"."run_id" IS NULL THEN 1
    WHEN "owners"."thread_id" = json_extract(
      "attempts"."payload_json",
      '$.authorization.threadId'
    ) THEN 1
    ELSE 0
  END
  ELSE 0
END
FROM "computer_use_attempts" AS "attempts"
LEFT JOIN "runs" AS "owners"
  ON "owners"."run_id" = json_extract("attempts"."payload_json", '$.authorization.runId');

DROP TABLE "computer_use_attempts_migration_guard";

CREATE TABLE "computer_use_attempts_next" (
  "attempt_id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload_json" TEXT NOT NULL,
  CONSTRAINT "computer_use_attempts_run_owner_fkey"
    FOREIGN KEY ("run_id", "thread_id") REFERENCES "runs"("run_id", "thread_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "computer_use_attempts_phase_revision_check" CHECK (
    ("phase" = 'queued' AND "revision" = 0)
    OR ("phase" = 'dispatched' AND "revision" = 1)
    OR ("phase" = 'settled' AND "revision" IN (1, 2))
  ),
  CONSTRAINT "computer_use_attempts_payload_json_check" CHECK (json_valid("payload_json")),
  CONSTRAINT "computer_use_attempts_payload_owner_check" CHECK (
    COALESCE(
      json_type("payload_json", '$.attemptId') = 'text'
      AND json_extract("payload_json", '$.attemptId') = "attempt_id"
      AND json_type("payload_json", '$.authorization.runId') = 'text'
      AND json_extract("payload_json", '$.authorization.runId') = "run_id"
      AND json_type("payload_json", '$.authorization.threadId') = 'text'
      AND json_extract("payload_json", '$.authorization.threadId') = "thread_id"
      AND json_type("payload_json", '$.phase') = 'text'
      AND json_extract("payload_json", '$.phase') = "phase"
      AND json_type("payload_json", '$.revision') = 'integer'
      AND json_extract("payload_json", '$.revision') = "revision",
      0
    )
  )
);

INSERT INTO "computer_use_attempts_next" (
  "attempt_id",
  "run_id",
  "thread_id",
  "phase",
  "revision",
  "payload_json"
)
SELECT
  "attempt_id",
  json_extract("payload_json", '$.authorization.runId'),
  json_extract("payload_json", '$.authorization.threadId'),
  "phase",
  "revision",
  "payload_json"
FROM "computer_use_attempts" AS "attempts"
INNER JOIN "runs" AS "owners"
  ON "owners"."run_id" = json_extract("attempts"."payload_json", '$.authorization.runId')
  AND "owners"."thread_id" = json_extract("attempts"."payload_json", '$.authorization.threadId');

DROP TABLE "computer_use_attempts";
ALTER TABLE "computer_use_attempts_next" RENAME TO "computer_use_attempts";

CREATE INDEX "idx_computer_use_attempts_run_id" ON "computer_use_attempts"("run_id");
CREATE INDEX "idx_computer_use_attempts_thread_id" ON "computer_use_attempts"("thread_id");
