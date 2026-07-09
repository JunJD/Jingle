import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

  const completedRows = await getPrismaClient().$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL`
  )
  assert.equal(Number(completedRows[0]?.count ?? -1), 0, "no migration may be left incomplete")

  const tableRows = await getPrismaClient().$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )
  const tableNames = new Set(tableRows.map((row) => row.name))
  for (const table of ["threads", "projects", "messages", "runs", "checkpoints"]) {
    assert.ok(tableNames.has(table), `expected table ${table} to exist after first launch`)
  }
})

test("restart after auto-migration is idempotent", async () => {
  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")

  await closeDatabase()
  await initializeDatabase()

  const { getPrismaClient } = await import("../../src/main/db/client")
  const threadCount = await getPrismaClient().thread.count()
  assert.equal(typeof threadCount, "number")
})
