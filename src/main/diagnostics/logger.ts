import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync
} from "fs"
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
const LOG_FILE_NAME = "jingle.log"

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

  errorSync(message: string, fields?: DiagnosticsLogFields): void {
    this.writeSync("error", message, fields)
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private write(level: DiagnosticsLevel, message: string, fields?: DiagnosticsLogFields): void {
    const record = this.createRecord(level, message, fields)
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

  private writeSync(level: DiagnosticsLevel, message: string, fields?: DiagnosticsLogFields): void {
    const record = this.createRecord(level, message, fields)
    const line = `${JSON.stringify(record)}\n`
    try {
      this.rotateIfNeeded(Buffer.byteLength(line, "utf8"))
      appendFileSync(this.logFilePath, line, "utf8")
    } catch (error) {
      console.error("[Diagnostics] Failed to write log:", error)
    }
  }

  private createRecord(
    level: DiagnosticsLevel,
    message: string,
    fields?: DiagnosticsLogFields
  ): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields
    }
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
    const rotatedFiles: Array<{ index: number; name: string }> = []
    for (const name of readdirSync(logDir)) {
      if (!name.startsWith(prefix)) {
        continue
      }

      const index = Number.parseInt(name.slice(prefix.length), 10)
      if (Number.isInteger(index)) {
        rotatedFiles.push({ name, index })
      }
    }
    rotatedFiles.sort((a, b) => b.index - a.index)

    for (const file of rotatedFiles) {
      if (file.index <= this.maxFiles) {
        continue
      }
      unlinkSync(join(logDir, file.name))
    }
  }
}
