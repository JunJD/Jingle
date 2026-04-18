import { mkdirSync } from "fs"
import { dirname } from "path"
import { getDbPath } from "../storage"
import { closePrismaClient, getPrismaClient } from "./client"

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "threads",
  "runs",
  "messages_fts",
  "messages_fts_trigram",
  "artifacts",
  "artifact_presentations",
  "assistants",
  "session_bindings",
  "hitl_requests",
  "checkpoints",
  "writes"
] as const

const REQUIRED_TABLE_COLUMNS = {
  hitl_requests: ["review_kind", "review_payload"]
} as const

let initialized = false

async function ensurePrismaSchemaApplied(): Promise<void> {
  const prisma = getPrismaClient()
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )) as Array<{ name: string }>
  const names = new Set(rows.map((row) => row.name))
  const missing = REQUIRED_TABLES.filter((name) => !names.has(name))

  if (missing.length === 0) {
    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
      const columnRows = (await prisma.$queryRawUnsafe(
        `PRAGMA table_info("${tableName}")`
      )) as Array<{ name: string }>
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
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON")
  await ensurePrismaSchemaApplied()

  initialized = true
}

export async function closeDatabase(): Promise<void> {
  initialized = false
  await closePrismaClient()
}
