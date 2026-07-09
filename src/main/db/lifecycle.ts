import { createHash, randomUUID } from "crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { Prisma } from "@prisma/client"
import { getDbPath } from "../storage"
import { closePrismaClient, getPrismaClient } from "./client"
import { flushAgentTraceProjection } from "./agent-events"
import { flushThreadDigestProjection } from "../projection/thread-digest-queue"

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "threads",
  "projects",
  "thread_workspace_bindings",
  "runs",
  "messages",
  "message_events",
  "message_state_versions",
  "messages_fts",
  "messages_fts_trigram",
  "thread_digests",
  "thread_digests_fts",
  "thread_digests_fts_trigram",
  "workflow_statuses",
  "workflow_labels",
  "thread_workflows",
  "thread_labels",
  "thread_spawn_edges",
  "artifacts",
  "artifact_presentations",
  "assistants",
  "session_bindings",
  "hitl_requests",
  "checkpoints",
  "checkpoint_blobs",
  "writes",
  "agent_events",
  "agent_event_sequences",
  "agent_traces",
  "agent_trace_steps",
  "agent_trace_blobs",
  "agent_memories",
  "agent_memory_suggestions",
  "agent_memory_inclusions"
] as const

const REQUIRED_TABLE_COLUMNS = {
  threads: ["archived_at"],
  messages: ["seq", "raw_message", "raw_hash", "run_id"],
  hitl_requests: ["review_kind", "review_payload"],
  checkpoints: ["run_id"]
} as const
const DATABASE_SCHEMA_RECOVERY_HINT =
  "The app applies packaged Prisma migrations automatically during startup; if this is a packaged install, restart Jingle and check the main-process logs. In development, run `pnpm prisma:migrate:deploy`."

let initialized = false

interface MigrationFile {
  checksum: string
  name: string
  statements: string[]
}

interface MigrationRow {
  checksum: string
  finished_at: Date | string | null
  migration_name: string
  rolled_back_at: Date | string | null
}

function getMigrationsDir(): string {
  const candidateDirs = [
    resolve(__dirname, "../../../prisma/migrations"),
    resolve(__dirname, "../../prisma/migrations")
  ]

  const migrationsDir = candidateDirs.find((candidate) => existsSync(candidate))
  if (!migrationsDir) {
    throw new Error(`Prisma migrations directory is missing. Checked: ${candidateDirs.join(", ")}`)
  }

  return migrationsDir
}

function readMigrationFiles(): MigrationFile[] {
  const migrationsDir = getMigrationsDir()

  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const migrationPath = join(migrationsDir, entry.name, "migration.sql")
      if (!existsSync(migrationPath)) {
        throw new Error(`Prisma migration SQL is missing: ${migrationPath}`)
      }

      const sql = readFileSync(migrationPath, "utf-8")
      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        name: entry.name,
        statements: splitSqlStatements(sql)
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const nextChar = sql[index + 1]

    if (inLineComment) {
      current += char
      if (char === "\n") {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      current += char
      if (char === "*" && nextChar === "/") {
        current += nextChar
        index += 1
        inBlockComment = false
      }
      continue
    }

    if (inSingleQuote) {
      current += char
      if (char === "'" && nextChar === "'") {
        current += nextChar
        index += 1
        continue
      }
      if (char === "'") {
        inSingleQuote = false
      }
      continue
    }

    if (inDoubleQuote) {
      current += char
      if (char === '"' && nextChar === '"') {
        current += nextChar
        index += 1
        continue
      }
      if (char === '"') {
        inDoubleQuote = false
      }
      continue
    }

    if (char === "-" && nextChar === "-") {
      current += char + nextChar
      index += 1
      inLineComment = true
      continue
    }

    if (char === "/" && nextChar === "*") {
      current += char + nextChar
      index += 1
      inBlockComment = true
      continue
    }

    if (char === "'") {
      current += char
      inSingleQuote = true
      continue
    }

    if (char === '"') {
      current += char
      inDoubleQuote = true
      continue
    }

    if (char === ";") {
      const statement = current.trim()
      if (hasExecutableSqlStatement(statement)) {
        statements.push(statement)
      }
      current = ""
      continue
    }

    current += char
  }

  const statement = current.trim()
  if (hasExecutableSqlStatement(statement)) {
    statements.push(statement)
  }

  return statements
}

function hasExecutableSqlStatement(statement: string): boolean {
  return statement.split("\n").some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("--") && !trimmed.startsWith("/*")
  })
}

async function ensurePrismaMigrationsTable(): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )
  `)
}

async function getAppliedMigrations(): Promise<Map<string, MigrationRow>> {
  const rows = await getPrismaClient().$queryRawUnsafe<MigrationRow[]>(`
    SELECT "checksum", "finished_at", "migration_name", "rolled_back_at"
    FROM "_prisma_migrations"
  `)

  return new Map(rows.map((row) => [row.migration_name, row]))
}

function assertMigrationCanBeSkipped(migration: MigrationFile, row: MigrationRow): void {
  if (row.rolled_back_at !== null || row.finished_at === null) {
    throw new Error(
      `Prisma migration ${migration.name} is not in a completed state for ${getDbPath()}.`
    )
  }

  if (row.checksum !== migration.checksum) {
    throw new Error(
      `Prisma migration ${migration.name} checksum does not match the packaged migration SQL for ${getDbPath()}.`
    )
  }
}

async function applyMigration(migration: MigrationFile): Promise<void> {
  const prisma = getPrismaClient()
  const now = Date.now()
  const migrationId = randomUUID()

  try {
    await prisma.$transaction(async (tx) => {
      await executeMigrationStatements(tx, migration.statements)
      await tx.$executeRawUnsafe(
        `
          INSERT INTO "_prisma_migrations" (
            "id",
            "checksum",
            "finished_at",
            "migration_name",
            "started_at",
            "applied_steps_count"
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        migrationId,
        migration.checksum,
        now,
        migration.name,
        now,
        1
      )
    })
    console.info(`[DB] Applied Prisma migration ${migration.name}`)
  } catch (error) {
    throw new Error(
      `Failed to apply Prisma migration ${migration.name} for ${getDbPath()}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function executeMigrationStatements(
  tx: Prisma.TransactionClient,
  statements: readonly string[]
): Promise<void> {
  for (const statement of statements) {
    await tx.$executeRawUnsafe(statement)
  }
}

async function applyPendingPrismaMigrations(): Promise<void> {
  await ensurePrismaMigrationsTable()

  const migrations = readMigrationFiles()
  const appliedMigrations = await getAppliedMigrations()

  for (const migration of migrations) {
    const applied = appliedMigrations.get(migration.name)
    if (applied) {
      assertMigrationCanBeSkipped(migration, applied)
      continue
    }

    await applyMigration(migration)
  }
}

async function recoverIncompleteAgentRuns(): Promise<void> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const [runs, threads] = await prisma.$transaction([
    prisma.run.updateMany({
      data: {
        status: "interrupted",
        updatedAt: now
      },
      where: {
        status: "running"
      }
    }),
    prisma.thread.updateMany({
      data: {
        status: "interrupted",
        updatedAt: now
      },
      where: {
        status: "busy"
      }
    })
  ])

  if (runs.count > 0 || threads.count > 0) {
    console.warn(
      `[DB] Recovered incomplete agent state: interrupted ${runs.count} run(s), ${threads.count} thread(s).`
    )
  }
}

async function ensurePrismaSchemaApplied(): Promise<void> {
  const prisma = getPrismaClient()
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `
  const names = new Set(rows.map((row) => row.name))
  const missing = REQUIRED_TABLES.filter((name) => !names.has(name))

  if (missing.length === 0) {
    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
      const columnRows = await prisma.$queryRaw<Array<{ name: string }>>(
        Prisma.sql`SELECT name FROM pragma_table_info(${tableName})`
      )
      const columnNames = new Set(columnRows.map((row) => row.name))
      const missingColumns = requiredColumns.filter((column) => !columnNames.has(column))

      if (missingColumns.length > 0) {
        throw new Error(
          `Database schema is not initialized for ${getDbPath()}. Missing columns in ${tableName}: ${missingColumns.join(", ")}. ${DATABASE_SCHEMA_RECOVERY_HINT}`
        )
      }
    }

    return
  }

  throw new Error(
    `Database schema is not initialized for ${getDbPath()}. Missing tables: ${missing.join(", ")}. ${DATABASE_SCHEMA_RECOVERY_HINT}`
  )
}

export async function initializeDatabase(): Promise<void> {
  if (initialized) {
    return
  }

  const filePath = getDbPath()
  mkdirSync(dirname(filePath), { recursive: true })

  const prisma = getPrismaClient()
  await prisma.$connect()
  await Promise.all([
    prisma.$queryRaw`PRAGMA journal_mode = WAL`,
    prisma.$executeRaw`PRAGMA foreign_keys = ON`
  ])
  await applyPendingPrismaMigrations()
  await ensurePrismaSchemaApplied()
  await recoverIncompleteAgentRuns()

  initialized = true
}

export async function closeDatabase(): Promise<void> {
  initialized = false
  await Promise.all([flushAgentTraceProjection(), flushThreadDigestProjection()])
  await closePrismaClient()
}
