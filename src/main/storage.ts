import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync } from "fs"
const DEFAULT_OPENWORK_DIR = join(homedir(), ".openwork")

function resolveOpenworkDir(): string {
  const override = process.env["OPENWORK_HOME"]?.trim()
  return override && override.length > 0 ? override : DEFAULT_OPENWORK_DIR
}

export function getOpenworkDir(): string {
  const openworkDir = resolveOpenworkDir()
  if (!existsSync(openworkDir)) {
    mkdirSync(openworkDir, { recursive: true })
  }
  return openworkDir
}

export function getDbPath(): string {
  return join(getOpenworkDir(), "openwork.sqlite")
}

export function getEnvFilePath(): string {
  return join(getOpenworkDir(), ".env")
}

export function getEnvValue(name: string): string | undefined {
  const env = parseEnvFile()
  if (env[name]) {
    return env[name]
  }

  return process.env[name]
}

// Read .env file and parse into object
function parseEnvFile(): Record<string, string> {
  const envPath = getEnvFilePath()
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      result[key] = value
    }
  }
  return result
}
