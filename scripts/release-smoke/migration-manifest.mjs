import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const repoMigrationsRoot = fileURLToPath(new URL("../../prisma/migrations", import.meta.url))

function fail(message) {
  throw new Error(`Release migration manifest: ${message}`)
}

// Single source of truth for the migration ledger this checkout expects a Jingle
// database to carry. `checksum` is the digest both the Prisma CLI and the main
// process write into `_prisma_migrations`, so callers can compare a manifest
// entry against a database row without re-deriving either side.
export function readMigrationManifest(migrationsRoot = repoMigrationsRoot) {
  if (!existsSync(migrationsRoot)) {
    fail(`migrations directory is missing: ${migrationsRoot}`)
  }
  const manifest = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = join(migrationsRoot, entry.name, "migration.sql")
      if (!existsSync(sqlPath)) fail(`migration SQL is missing: ${entry.name}`)
      const sql = readFileSync(sqlPath)
      if (sql.includes(13)) {
        fail(
          `migration SQL must use canonical LF line endings so its checksum is platform-independent: ${entry.name}`
        )
      }
      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        name: entry.name
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  if (manifest.length === 0) fail("this checkout declares no Prisma migrations")
  return manifest
}
