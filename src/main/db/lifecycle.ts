import { mkdirSync } from "fs"
import { dirname } from "path"
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

let initialized = false

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
          `Database schema is not initialized for ${getDbPath()}. Missing columns in ${tableName}: ${missingColumns.join(", ")}. Run \`pnpm prisma:migrate:deploy\` before starting the app.`
        )
      }
    }

    return
  }

  throw new Error(
    `Database schema is not initialized for ${getDbPath()}. Missing tables: ${missing.join(", ")}. Run \`pnpm prisma:migrate:deploy\` before starting the app.`
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
  await ensurePrismaSchemaApplied()
  await recoverIncompleteAgentRuns()

  initialized = true
}

export async function closeDatabase(): Promise<void> {
  initialized = false
  await Promise.all([flushAgentTraceProjection(), flushThreadDigestProjection()])
  await closePrismaClient()
}
