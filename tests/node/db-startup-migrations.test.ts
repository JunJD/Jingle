import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

// Issue #100 复现场景:安装版首次启动时本地不存在 jingle.sqlite,
// 也没有人工执行过 `pnpm prisma:migrate:deploy`。
// 期望:initializeDatabase() 自动应用打包内全部 Prisma 迁移。
test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-db-startup-migrations-"))
  process.env.JINGLE_HOME = jingleHome
})

test.after(async () => {
  const { closeDatabase } = await import("../../src/main/db")
  await closeDatabase()

  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }

  await rm(jingleHome, { force: true, recursive: true })
})

test("first launch applies packaged Prisma migrations to a fresh database", async () => {
  const dbPath = join(jingleHome, "jingle.sqlite")
  assert.equal(existsSync(dbPath), false, "database file must not exist before first launch")

  const { initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")

  await initializeDatabase()

  const packagedMigrationNames = (
    await readdir(join(repoRoot, "prisma", "migrations"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  assert.ok(packagedMigrationNames.length > 0, "expected packaged migrations in the repo")

  const appliedRows = await getPrismaClient().$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "migration_name"`
  )
  assert.deepEqual(
    appliedRows.map((row) => row.migration_name),
    packagedMigrationNames,
    "every packaged migration must be recorded as applied"
  )
  const projectionJobColumns = await getPrismaClient().$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("assistant_content_projection_jobs")`
  )
  assert.deepEqual(
    projectionJobColumns.map((column) => column.name),
    [
      "run_id",
      "generation",
      "status",
      "attempt_count",
      "last_error",
      "created_at",
      "updated_at",
      "failure_code",
      "next_attempt_at"
    ]
  )

  const completedRows = await getPrismaClient().$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL`
  )
  assert.equal(Number(completedRows[0]?.count ?? -1), 0, "no migration may be left incomplete")

  const tableRows = await getPrismaClient().$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )
  const tableNames = new Set(tableRows.map((row) => row.name))
  for (const table of [
    "threads",
    "projects",
    "messages",
    "runs",
    "checkpoints",
    "assistant_content_projection_jobs",
    "assistant_content_projection_blocked_inputs"
  ]) {
    assert.ok(tableNames.has(table), `expected table ${table} to exist after first launch`)
  }

  const blockedInputColumns = await getPrismaClient().$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("assistant_content_projection_blocked_inputs")`
  )
  assert.deepEqual(
    blockedInputColumns.map((column) => column.name),
    ["run_id", "message_id", "source_revision", "reason", "detail"]
  )
  const retryIndexColumns = await getPrismaClient().$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA index_info("idx_assistant_content_projection_jobs_retry_due")`
  )
  assert.deepEqual(
    retryIndexColumns.map((column) => column.name),
    ["status", "next_attempt_at", "run_id"]
  )
  const projectionJobIndexColumns = await getPrismaClient().$queryRawUnsafe<
    Array<{ name: string }>
  >(`PRAGMA index_info("idx_assistant_content_projection_jobs_status_run_id")`)
  assert.deepEqual(
    projectionJobIndexColumns.map((column) => column.name),
    ["status", "run_id"]
  )
  const recoveryPlan = await getPrismaClient().$queryRawUnsafe<Array<{ detail: string }>>(
    `EXPLAIN QUERY PLAN
     SELECT "run_id" FROM "assistant_content_projection_jobs"
     WHERE "status" IN ('pending', 'failed') AND "run_id" > ''
     ORDER BY "run_id" ASC LIMIT 100`
  )
  assert.ok(
    recoveryPlan.some((row) =>
      row.detail.includes("idx_assistant_content_projection_jobs_status_run_id")
    )
  )
})

test("restart after auto-migration is idempotent", async () => {
  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")

  await closeDatabase()
  await initializeDatabase()

  const { getPrismaClient } = await import("../../src/main/db/client")
  const threadCount = await getPrismaClient().thread.count()
  assert.equal(typeof threadCount, "number")
})

test("retry migration parks legacy untyped failures instead of granting a retry lease", () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(`
      CREATE TABLE "assistant_content_projection_jobs" (
        "run_id" TEXT NOT NULL PRIMARY KEY,
        "generation" INTEGER NOT NULL DEFAULT 1,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "attempt_count" INTEGER NOT NULL DEFAULT 0,
        "last_error" TEXT,
        "created_at" BIGINT NOT NULL,
        "updated_at" BIGINT NOT NULL
      );
      INSERT INTO "assistant_content_projection_jobs"
        ("run_id", "status", "attempt_count", "last_error", "created_at", "updated_at")
      VALUES ('run-legacy-failure', 'failed', 2, 'legacy untyped failure', 1, 1);
    `)
    database.exec(
      readFileSync(
        join(
          repoRoot,
          "prisma/migrations/20260717090000_add_assistant_content_projection_retry_state/migration.sql"
        ),
        "utf8"
      )
    )
    const migrated = database
      .prepare(
        `SELECT status, failure_code AS failureCode, next_attempt_at AS nextAttemptAt
         FROM assistant_content_projection_jobs WHERE run_id = ?`
      )
      .get("run-legacy-failure") as {
      failureCode: string | null
      nextAttemptAt: number | null
      status: string
    }
    assert.deepEqual(
      { ...migrated },
      {
        failureCode: "unexpected",
        nextAttemptAt: null,
        status: "parked"
      }
    )
  } finally {
    database.close()
  }
})

test("blocked-input detail migration preserves message ownership and clears job detail", () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(`
      CREATE TABLE "assistant_content_projection_jobs" (
        "run_id" TEXT NOT NULL PRIMARY KEY,
        "status" TEXT NOT NULL,
        "last_error" TEXT
      );
      CREATE TABLE "assistant_content_projection_blocked_inputs" (
        "run_id" TEXT NOT NULL,
        "message_id" TEXT NOT NULL,
        "source_revision" TEXT NOT NULL,
        "reason" TEXT NOT NULL,
        PRIMARY KEY ("run_id", "message_id")
      );
      INSERT INTO "assistant_content_projection_jobs" ("run_id", "status", "last_error")
      VALUES ('run-blocked', 'blocked', 'first input detail');
      INSERT INTO "assistant_content_projection_blocked_inputs"
        ("run_id", "message_id", "source_revision", "reason")
      VALUES
        ('run-blocked', 'message-invalid', 'sha256:invalid', 'invalid-json'),
        ('run-blocked', 'message-noncanonical', 'sha256:noncanonical', 'noncanonical');
    `)
    database.exec(
      readFileSync(
        join(
          repoRoot,
          "prisma/migrations/20260729234500_bind_projection_block_details_to_messages/migration.sql"
        ),
        "utf8"
      )
    )
    const rows = database
      .prepare(
        `SELECT message_id AS messageId, reason, detail
         FROM assistant_content_projection_blocked_inputs ORDER BY message_id`
      )
      .all()
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          detail: "Assistant content projection rejected invalid-json persisted content.",
          messageId: "message-invalid",
          reason: "invalid-json"
        },
        {
          detail: "Assistant content projection rejected noncanonical persisted content.",
          messageId: "message-noncanonical",
          reason: "noncanonical"
        }
      ]
    )
    assert.equal(
      (
        database
          .prepare(`SELECT last_error AS lastError FROM assistant_content_projection_jobs`)
          .get() as { lastError: string | null }
      ).lastError,
      null
    )
  } finally {
    database.close()
  }
})
