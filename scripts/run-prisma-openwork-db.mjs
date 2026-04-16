import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { runLocalCommand } from "./lib/run-local-command.mjs"

function getOpenworkDir() {
  const override = process.env.OPENWORK_HOME?.trim()
  return override && override.length > 0 ? override : join(homedir(), ".openwork")
}

function toSqliteDatabaseUrl(filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/")
  return `file:${normalizedPath}`
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    throw new Error("Usage: node scripts/run-prisma-openwork-db.mjs <prisma args...>")
  }

  const openworkDir = getOpenworkDir()
  mkdirSync(openworkDir, { recursive: true })

  const env = {
    ...process.env,
    DATABASE_URL: toSqliteDatabaseUrl(join(openworkDir, "openwork.sqlite"))
  }

  await runLocalCommand("prisma", args, { env })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
