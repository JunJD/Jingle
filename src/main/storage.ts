import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync } from "fs"

const JINGLE_HOME_ENV = "JINGLE_HOME"
const DEFAULT_JINGLE_DIR = join(homedir(), ".jingle")
const JINGLE_DATABASE_FILE = "jingle.sqlite"
const ENV_ASSIGNMENT_PATTERN = /^([^=]+)=(.*)$/

interface JingleHomeResolution {
  databaseFileName: string
  dir: string
}

function readEnvPath(name: string): string | null {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return null
  }

  const value = rawValue.trim()
  if (value.length === 0) {
    return null
  }

  return value
}

export function hasJingleHomeOverride(): boolean {
  return readEnvPath(JINGLE_HOME_ENV) !== null
}

export function hasExplicitJingleStorageHome(): boolean {
  return hasJingleHomeOverride()
}

function resolveJingleHome(): JingleHomeResolution {
  const jingleHome = readEnvPath(JINGLE_HOME_ENV)
  if (jingleHome) {
    return {
      databaseFileName: JINGLE_DATABASE_FILE,
      dir: jingleHome
    }
  }

  return {
    databaseFileName: JINGLE_DATABASE_FILE,
    dir: DEFAULT_JINGLE_DIR
  }
}

function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
  return path
}

export function getJingleHomeDir(): string {
  const { dir } = resolveJingleHome()
  return ensureDir(dir)
}

export function getJingleDbPath(): string {
  const resolution = resolveJingleHome()
  const dir = ensureDir(resolution.dir)
  return join(dir, resolution.databaseFileName)
}

export function getJingleEnvFilePath(): string {
  const { dir } = resolveJingleHome()
  return join(ensureDir(dir), ".env")
}

export function getDbPath(): string {
  return getJingleDbPath()
}

export function getEnvFilePath(): string {
  return getJingleEnvFilePath()
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
  const envPath = getJingleEnvFilePath()
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const assignment = ENV_ASSIGNMENT_PATTERN.exec(trimmed)
    if (!assignment) {
      continue
    }

    const key = assignment[1].trim()
    const value = assignment[2].trim()
    result[key] = value
  }
  return result
}
