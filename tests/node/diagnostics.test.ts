import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
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

function createTempLogPaths(): { logDir: string; rootDir: string } {
  const rootDir = join(tmpdir(), `jingle-diagnostics-${Date.now()}-${Math.random()}`)
  mkdirSync(rootDir, { recursive: true })
  return { logDir: join(rootDir, "logs"), rootDir }
}

test("diagnostics logger writes structured local log records", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, rootDir })

    logger.error("Renderer reported error", {
      appVersion: "3.2.1",
      commandId: "command-1",
      electronVersion: "37.2.0",
      isPackaged: true,
      message: "Renderer promise rejected",
      platform: "darwin",
      presentationId: 42,
      reason: "crashed",
      requestId: "request-1",
      threadId: "thread-1",
      windowKind: "main"
    })
    await logger.flush()

    const line = readFileSync(logger.getLogFilePath(), "utf8").trim()
    const record = JSON.parse(line) as Record<string, unknown>

    assert.equal(record["level"], "error")
    assert.equal(record["message"], "Renderer reported error")
    assert.equal(record["detailMessage"], "Renderer promise rejected")
    assert.equal(record["threadId"], "thread-1")
    assert.equal(record["commandId"], "command-1")
    assert.equal(record["requestId"], "request-1")
    assert.equal(record["presentationId"], 42)
    assert.equal(record["appVersion"], "3.2.1")
    assert.equal(record["electronVersion"], "37.2.0")
    assert.equal(record["isPackaged"], true)
    assert.equal(record["platform"], "darwin")
    assert.equal(record["reason"], "crashed")
    assert.equal(record["windowKind"], "main")
    assert.equal(typeof record["timestamp"], "string")
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger rotates old local log files", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({
      logDir,
      maxBytes: 120,
      maxFiles: 2,
      rootDir
    })

    for (const message of ["first", "second", "third", "fourth", "fifth", "sixth"]) {
      logger.info(message, { payload: message.repeat(40) })
    }
    await logger.flush()

    const currentPath = logger.getLogFilePath()
    const rotatedPaths = [currentPath, `${currentPath}.1`, `${currentPath}.2`]
    assert.deepEqual(
      rotatedPaths.map((path) => {
        const record = JSON.parse(readFileSync(path, "utf8").trim()) as { message: string }
        return record.message
      }),
      ["sixth", "fifth", "fourth"]
    )
    assert.equal(existsSync(`${currentPath}.3`), false)
    if (process.platform !== "win32") {
      assert.deepEqual(
        rotatedPaths.map((path) => statSync(path).mode & 0o777),
        [0o600, 0o600, 0o600]
      )
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger writes fatal records through the ordered queue", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, rootDir })

    await logger.errorAndFlush("Main process fatal error", {
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
    rmSync(rootDir, { recursive: true, force: true })
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
