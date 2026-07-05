import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DiagnosticsLogger } from "../../src/main/diagnostics/logger"
import {
  errorFromUnhandledRejection,
  formatFatalMainProcessError,
  serializeProcessError
} from "../../src/main/diagnostics/process-errors"
import { normalizeRendererErrorReport } from "../../src/main/diagnostics/renderer-report"

function createTempLogDir(): string {
  const dir = join(tmpdir(), `jingle-diagnostics-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

test("diagnostics logger writes structured local log records", async () => {
  const logDir = createTempLogDir()
  try {
    const logger = new DiagnosticsLogger({ logDir })

    logger.error("Renderer process gone", {
      reason: "crashed",
      windowKind: "main"
    })
    await logger.flush()

    const line = readFileSync(logger.getLogFilePath(), "utf8").trim()
    const record = JSON.parse(line) as Record<string, unknown>

    assert.equal(record["level"], "error")
    assert.equal(record["message"], "Renderer process gone")
    assert.equal(record["reason"], "crashed")
    assert.equal(record["windowKind"], "main")
    assert.equal(typeof record["timestamp"], "string")
  } finally {
    rmSync(logDir, { recursive: true, force: true })
  }
})

test("diagnostics logger rotates old local log files", async () => {
  const logDir = createTempLogDir()
  try {
    const logger = new DiagnosticsLogger({
      logDir,
      maxBytes: 120,
      maxFiles: 2
    })

    logger.info("first", { payload: "x".repeat(100) })
    logger.info("second", { payload: "y".repeat(100) })
    logger.info("third", { payload: "z".repeat(100) })
    await logger.flush()

    assert.equal(existsSync(logger.getLogFilePath()), true)
    assert.equal(existsSync(`${logger.getLogFilePath()}.1`), true)
    assert.equal(existsSync(`${logger.getLogFilePath()}.2`), true)
    assert.equal(existsSync(`${logger.getLogFilePath()}.3`), false)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
  }
})

test("diagnostics logger writes fatal records synchronously", () => {
  const logDir = createTempLogDir()
  try {
    const logger = new DiagnosticsLogger({ logDir })

    logger.errorSync("Main process fatal error", {
      error: {
        message: "boom"
      },
      origin: "uncaughtException"
    })

    const line = readFileSync(logger.getLogFilePath(), "utf8").trim()
    const record = JSON.parse(line) as Record<string, unknown>

    assert.equal(record["level"], "error")
    assert.equal(record["message"], "Main process fatal error")
    assert.equal(record["origin"], "uncaughtException")
    assert.deepEqual(record["error"], {
      message: "boom"
    })
  } finally {
    rmSync(logDir, { recursive: true, force: true })
  }
})

test("renderer error reports are normalized before local logging", () => {
  assert.deepEqual(
    normalizeRendererErrorReport({
      kind: "unhandledrejection",
      message: "  Failed to render  ",
      stack: " stack ",
      source: " app.js ",
      windowKind: " main ",
      extra: "ignored"
    }),
    {
      kind: "unhandledrejection",
      message: "Failed to render",
      source: "app.js",
      stack: "stack",
      windowKind: "main"
    }
  )

  assert.deepEqual(normalizeRendererErrorReport({}), {
    kind: "error",
    message: "Renderer error"
  })
})

test("process diagnostics normalize fatal main process errors", () => {
  const error = new TypeError("Object has been destroyed")
  const serialized = serializeProcessError(error)

  assert.equal(serialized.name, "TypeError")
  assert.equal(serialized.message, "Object has been destroyed")
  assert.match(String(serialized.stack), /TypeError: Object has been destroyed/)

  assert.deepEqual(serializeProcessError("plain failure"), {
    message: "plain failure"
  })

  assert.equal(errorFromUnhandledRejection(error), error)
  assert.equal(
    errorFromUnhandledRejection("plain rejection").message,
    "Unhandled promise rejection: plain rejection"
  )

  assert.equal(
    formatFatalMainProcessError(error, "/tmp/jingle.log"),
    [
      "Object has been destroyed",
      "",
      "Diagnostics were written to: /tmp/jingle.log",
      "",
      "Jingle will quit now. Please restart the app."
    ].join("\n")
  )
})
