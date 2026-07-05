import { homedir } from "node:os"
import { join } from "node:path"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { runLocalCommand } from "./lib/run-local-command.mjs"

const JINGLE_HOME_ENV = "JINGLE_HOME"
const JINGLE_STORAGE_DIR = ".jingle"
const JINGLE_DATABASE_FILE = "jingle.sqlite"

function resolveJinglePrismaStorageDir() {
  const jingleHome = process.env[JINGLE_HOME_ENV]?.trim()
  if (jingleHome) {
    return {
      databaseFileName: JINGLE_DATABASE_FILE,
      dir: jingleHome
    }
  }

  return {
    databaseFileName: JINGLE_DATABASE_FILE,
    dir: join(homedir(), JINGLE_STORAGE_DIR)
  }
}

function toSqliteDatabaseUrl(filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/")
  return `file:${normalizedPath}`
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    throw new Error("Usage: node scripts/run-prisma-jingle-db.mjs <prisma args...>")
  }

  const { databaseFileName, dir: storageDir } = resolveJinglePrismaStorageDir()
  mkdirSync(storageDir, { recursive: true })
  const databasePath = join(storageDir, databaseFileName)
  if (args[0] === "migrate" && !existsSync(databasePath)) {
    closeSync(openSync(databasePath, "w"))
  }
  const databaseUrl = toSqliteDatabaseUrl(databasePath)

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl
  }

  console.error(`[prisma] using ${databaseUrl}`)
  await runLocalCommand("prisma", args, { env })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
