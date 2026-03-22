import { mkdirSync } from "fs"
import { dirname } from "path"
import { getDbPath } from "../storage"
import { closePrismaClient, getPrismaClient } from "./client"

const THREADS_DDL = (tableName = "threads"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    thread_id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    metadata TEXT,
    status TEXT DEFAULT 'idle',
    thread_values TEXT,
    title TEXT
  )
`

const RUNS_DDL = (tableName = "runs"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    run_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    assistant_id TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    status TEXT,
    metadata TEXT,
    kwargs TEXT,
    FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE,
    FOREIGN KEY (assistant_id) REFERENCES assistants(assistant_id) ON DELETE SET NULL
  )
`

const ASSISTANTS_DDL = (tableName = "assistants"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    assistant_id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    name TEXT,
    model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
    config TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )
`

const SESSION_BINDINGS_DDL = (tableName = "session_bindings"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    session_key TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    current_thread_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (current_thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
  )
`

const CHECKPOINTS_DDL = (tableName = "checkpoints"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint TEXT,
    metadata TEXT,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id),
    FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
  )
`

const WRITES_DDL = (tableName = "writes"): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    value TEXT,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
    FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
  )
`

const INDEX_DDLS = [
  `CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_session_bindings_workspace_key ON session_bindings(workspace_key)`,
  `CREATE INDEX IF NOT EXISTS idx_session_bindings_thread_id ON session_bindings(current_thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_ns ON checkpoints(thread_id, checkpoint_ns)`,
  `CREATE INDEX IF NOT EXISTS idx_writes_thread_checkpoint ON writes(thread_id, checkpoint_ns, checkpoint_id)`
]

interface SqliteTableColumn {
  name: string
  type: string
}

interface TableSchemaConfig {
  tableName: string
  createTableSql: (tableName?: string) => string
  columns: string[]
  bigintColumns: string[]
}

const TABLE_SCHEMAS: TableSchemaConfig[] = [
  {
    tableName: "threads",
    createTableSql: THREADS_DDL,
    columns: [
      "thread_id",
      "created_at",
      "updated_at",
      "metadata",
      "status",
      "thread_values",
      "title"
    ],
    bigintColumns: ["created_at", "updated_at"]
  },
  {
    tableName: "assistants",
    createTableSql: ASSISTANTS_DDL,
    columns: ["assistant_id", "graph_id", "name", "model", "config", "created_at", "updated_at"],
    bigintColumns: ["created_at", "updated_at"]
  },
  {
    tableName: "runs",
    createTableSql: RUNS_DDL,
    columns: [
      "run_id",
      "thread_id",
      "assistant_id",
      "created_at",
      "updated_at",
      "status",
      "metadata",
      "kwargs"
    ],
    bigintColumns: ["created_at", "updated_at"]
  },
  {
    tableName: "session_bindings",
    createTableSql: SESSION_BINDINGS_DDL,
    columns: [
      "session_key",
      "workspace_key",
      "workspace_path",
      "current_thread_id",
      "created_at",
      "updated_at",
      "metadata"
    ],
    bigintColumns: ["created_at", "updated_at"]
  },
  {
    tableName: "checkpoints",
    createTableSql: CHECKPOINTS_DDL,
    columns: [
      "thread_id",
      "checkpoint_ns",
      "checkpoint_id",
      "parent_checkpoint_id",
      "type",
      "checkpoint",
      "metadata"
    ],
    bigintColumns: []
  },
  {
    tableName: "writes",
    createTableSql: WRITES_DDL,
    columns: [
      "thread_id",
      "checkpoint_ns",
      "checkpoint_id",
      "task_id",
      "idx",
      "channel",
      "type",
      "value"
    ],
    bigintColumns: []
  }
]

let initialized = false

export interface ThreadRow {
  thread_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  status: string
  thread_values: string | null
  title: string | null
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function mapThreadRow(row: {
  threadId: string
  createdAt: bigint
  updatedAt: bigint
  metadata: string | null
  status: string
  threadValues: string | null
  title: string | null
}): ThreadRow {
  return {
    thread_id: row.threadId,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    metadata: row.metadata,
    status: row.status,
    thread_values: row.threadValues,
    title: row.title
  }
}

async function ensureSchema(): Promise<void> {
  const prisma = getPrismaClient()

  await prisma.$connect()
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON")
  await prisma.$executeRawUnsafe(THREADS_DDL())
  await prisma.$executeRawUnsafe(ASSISTANTS_DDL())
  await prisma.$executeRawUnsafe(RUNS_DDL())
  await prisma.$executeRawUnsafe(SESSION_BINDINGS_DDL())
  await prisma.$executeRawUnsafe(CHECKPOINTS_DDL())
  await prisma.$executeRawUnsafe(WRITES_DDL())
  await migrateLegacyIntegerColumns(prisma)

  for (const ddl of INDEX_DDLS) {
    await prisma.$executeRawUnsafe(ddl)
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

async function getTableColumns(tableName: string): Promise<SqliteTableColumn[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
  return rows as SqliteTableColumn[]
}

function normalizeColumnType(type: string | null | undefined): string {
  return (type ?? "").trim().toUpperCase()
}

function needsBigIntMigration(columns: SqliteTableColumn[], bigintColumns: string[]): boolean {
  if (columns.length === 0 || bigintColumns.length === 0) {
    return false
  }

  return bigintColumns.some((columnName) => {
    const column = columns.find((entry) => entry.name === columnName)
    if (!column) {
      return false
    }

    return normalizeColumnType(column.type) !== "BIGINT"
  })
}

async function rebuildTable(config: TableSchemaConfig): Promise<void> {
  const prisma = getPrismaClient()
  const tempTableName = `__tmp_${config.tableName}`
  const quotedColumns = config.columns.map(quoteIdentifier).join(", ")

  await prisma.$executeRawUnsafe("BEGIN IMMEDIATE")

  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`)
    await prisma.$executeRawUnsafe(config.createTableSql(tempTableName))
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(tempTableName)} (${quotedColumns}) SELECT ${quotedColumns} FROM ${quoteIdentifier(config.tableName)}`
    )
    await prisma.$executeRawUnsafe(`DROP TABLE ${quoteIdentifier(config.tableName)}`)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(config.tableName)}`
    )
    await prisma.$executeRawUnsafe("COMMIT")
  } catch (error) {
    await prisma.$executeRawUnsafe("ROLLBACK")
    throw error
  }
}

async function migrateLegacyIntegerColumns(prisma = getPrismaClient()): Promise<void> {
  const tablesToRebuild: TableSchemaConfig[] = []

  for (const config of TABLE_SCHEMAS) {
    const columns = await getTableColumns(config.tableName)
    if (needsBigIntMigration(columns, config.bigintColumns)) {
      tablesToRebuild.push(config)
    }
  }

  if (tablesToRebuild.length === 0) {
    return
  }

  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF")

  try {
    for (const config of tablesToRebuild) {
      await rebuildTable(config)
    }
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON")
  }
}

export async function initializeDatabase(): Promise<void> {
  if (initialized) {
    return
  }

  const filePath = getDbPath()

  if (filePath) {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  await ensureSchema()
  initialized = true
}

export async function closeDatabase(): Promise<void> {
  initialized = false
  await closePrismaClient()
}

export async function getAllThreads(): Promise<ThreadRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.thread.findMany({
    orderBy: {
      updatedAt: "desc"
    }
  })

  return rows.map(mapThreadRow)
}

export async function getThread(threadId: string): Promise<ThreadRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.thread.findUnique({
    where: {
      threadId
    }
  })

  return row ? mapThreadRow(row) : null
}

export async function createThread(
  threadId: string,
  metadata?: Record<string, unknown>
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  const row = await prisma.thread.create({
    data: {
      threadId,
      createdAt: now,
      updatedAt: now,
      metadata: metadata ? JSON.stringify(metadata) : null,
      status: "idle"
    }
  })

  return mapThreadRow(row)
}

export async function updateThread(
  threadId: string,
  updates: Partial<Omit<ThreadRow, "thread_id" | "created_at">>
): Promise<ThreadRow | null> {
  const prisma = getPrismaClient()
  const existing = await prisma.thread.findUnique({
    where: {
      threadId
    }
  })

  if (!existing) {
    return null
  }

  const row = await prisma.thread.update({
    where: {
      threadId
    },
    data: {
      updatedAt: BigInt(Date.now()),
      metadata:
        updates.metadata === undefined
          ? undefined
          : typeof updates.metadata === "string"
            ? updates.metadata
            : JSON.stringify(updates.metadata),
      status: updates.status,
      threadValues: updates.thread_values,
      title: updates.title
    }
  })

  return mapThreadRow(row)
}

export async function deleteThread(threadId: string): Promise<void> {
  const prisma = getPrismaClient()

  await prisma.$transaction([
    prisma.checkpointWrite.deleteMany({
      where: { threadId }
    }),
    prisma.checkpoint.deleteMany({
      where: { threadId }
    }),
    prisma.sessionBinding.deleteMany({
      where: { currentThreadId: threadId }
    }),
    prisma.run.deleteMany({
      where: { threadId }
    }),
    prisma.thread.deleteMany({
      where: { threadId }
    })
  ])
}
