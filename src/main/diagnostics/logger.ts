import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "fs"
import { appendFile } from "fs/promises"
import { dirname, join } from "path"

export type DiagnosticsLevel = "info" | "warn" | "error"

export interface DiagnosticsLoggerOptions {
  logDir: string
  maxBytes?: number
  maxFiles?: number
}

export type DiagnosticsLogFields = object

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES = 5
const LOG_FILE_NAME = "openwork.log"

export class DiagnosticsLogger {
  private readonly logFilePath: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: DiagnosticsLoggerOptions) {
    this.logFilePath = join(options.logDir, LOG_FILE_NAME)
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
    mkdirSync(options.logDir, { recursive: true })
  }

  getLogFilePath(): string {
    return this.logFilePath
  }

  getLogDir(): string {
    return dirname(this.logFilePath)
  }

  info(message: string, fields?: DiagnosticsLogFields): void {
    this.write("info", message, fields)
  }

  warn(message: string, fields?: DiagnosticsLogFields): void {
    this.write("warn", message, fields)
  }

  error(message: string, fields?: DiagnosticsLogFields): void {
    this.write("error", message, fields)
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private write(level: DiagnosticsLevel, message: string, fields?: DiagnosticsLogFields): void {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields
    }
    const line = `${JSON.stringify(record)}\n`
    this.writeQueue = this.writeQueue
      .then(async () => {
        this.rotateIfNeeded(Buffer.byteLength(line, "utf8"))
        await appendFile(this.logFilePath, line, "utf8")
      })
      .catch((error) => {
        console.error("[Diagnostics] Failed to write log:", error)
      })
  }

  private rotateIfNeeded(incomingBytes: number): void {
    if (!existsSync(this.logFilePath)) {
      return
    }

    const currentBytes = statSync(this.logFilePath).size
    if (currentBytes + incomingBytes <= this.maxBytes) {
      return
    }

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const sourcePath = `${this.logFilePath}.${index}`
      const targetPath = `${this.logFilePath}.${index + 1}`
      if (existsSync(sourcePath)) {
        renameSync(sourcePath, targetPath)
      }
    }

    renameSync(this.logFilePath, `${this.logFilePath}.1`)
    this.pruneRotatedLogs()
  }

  private pruneRotatedLogs(): void {
    const prefix = `${LOG_FILE_NAME}.`
    const logDir = this.getLogDir()
    const rotatedFiles = readdirSync(logDir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({
        name,
        index: Number.parseInt(name.slice(prefix.length), 10)
      }))
      .filter((file) => Number.isInteger(file.index))
      .sort((a, b) => b.index - a.index)

    for (const file of rotatedFiles) {
      if (file.index <= this.maxFiles) {
        continue
      }
      unlinkSync(join(logDir, file.name))
    }
  }
}
