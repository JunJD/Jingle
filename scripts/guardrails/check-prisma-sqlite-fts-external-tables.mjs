import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { repoRoot } from "./lib/architecture-guardrails.mjs"

const SHADOW_SUFFIXES = ["_config", "_content", "_data", "_docsize", "_idx"]

function readMigrationSqlFiles() {
  const migrationsDir = join(repoRoot, "prisma", "migrations")
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsDir, entry.name, "migration.sql"))
    .map((path) => readFileSync(path, "utf8"))
}

function getDeclaredFtsTables() {
  const sql = readMigrationSqlFiles().join("\n")
  const ftsTables = new Set()
  const pattern = /CREATE\s+VIRTUAL\s+TABLE\s+"([^"]+)"\s+USING\s+fts5\s*\(/gi
  let match

  while ((match = pattern.exec(sql)) !== null) {
    ftsTables.add(match[1])
  }

  return [...ftsTables].sort()
}

function getExternalTablesFromPrismaConfig() {
  const config = readFileSync(join(repoRoot, "prisma.config.ts"), "utf8")
  const externalTables = new Set()
  const pattern = /"([^"]+)"/g
  let match

  while ((match = pattern.exec(config)) !== null) {
    externalTables.add(match[1])
  }

  return externalTables
}

const ftsTables = getDeclaredFtsTables()
const externalTables = getExternalTablesFromPrismaConfig()
const requiredExternalTables = ftsTables.flatMap((table) => [
  table,
  ...SHADOW_SUFFIXES.map((suffix) => `${table}${suffix}`)
])
const missingTables = requiredExternalTables.filter((table) => !externalTables.has(table))

if (missingTables.length > 0) {
  console.error("SQLite FTS tables must be declared as Prisma external tables.")
  console.error("")
  console.error("Missing from prisma.config.ts:")
  for (const table of missingTables) {
    console.error(`- ${table}`)
  }
  console.error("")
  console.error(
    "Prisma migrate introspects SQLite FTS5 shadow tables unless they are external, which can generate broken DROP TABLE migrations."
  )
  process.exit(1)
}

console.log("prisma sqlite fts external table guard passed")
