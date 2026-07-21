import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DiagnosticsLogger } from "../../src/main/diagnostics/logger"
import {
  diagnosticsBuildIdentity,
  getDiagnosticsBuildSourceRevision,
  parseDiagnosticsBuildIdentity
} from "../../src/main/diagnostics/build-identity"
import {
  errorFromUnhandledRejection,
  formatFatalMainProcessError,
  serializeProcessError
} from "../../src/main/diagnostics/process-errors"
import { normalizeRendererErrorReport } from "../../src/main/diagnostics/renderer-report"
import { sendRendererErrorReport } from "../../src/renderer/src/lib/diagnostics"

function createTempLogPaths(): { logDir: string; rootDir: string } {
  const rootDir = join(tmpdir(), `jingle-diagnostics-${Date.now()}-${Math.random()}`)
  mkdirSync(rootDir, { recursive: true })
  return { logDir: join(rootDir, "logs"), rootDir }
}

test("diagnostics build identity accepts only exact build-declared revisions", () => {
  assert.deepEqual(diagnosticsBuildIdentity, { kind: "untrusted" })
  assert.deepEqual(getDiagnosticsBuildSourceRevision(), {
    kind: "unavailable",
    reason: "untrusted-build"
  })
  assert.deepEqual(
    parseDiagnosticsBuildIdentity({
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "a".repeat(40)
    }),
    {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "a".repeat(40)
    }
  )
  assert.deepEqual(
    getDiagnosticsBuildSourceRevision(
      parseDiagnosticsBuildIdentity({
        declaredBy: "release-workflow",
        kind: "build-declared",
        sourceRevision: "b".repeat(64)
      })
    ),
    { kind: "available", provenance: "build-declared", value: "b".repeat(64) }
  )

  for (const invalid of [
    { declaredBy: "release-workflow", kind: "build-declared" },
    {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "A".repeat(40)
    },
    {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "a".repeat(39)
    },
    {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "a".repeat(41)
    },
    {
      declaredBy: "local-shell",
      kind: "build-declared",
      sourceRevision: "a".repeat(40)
    },
    {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: "a".repeat(40),
      trusted: true
    },
    { kind: "untrusted", sourceRevision: "a".repeat(40) },
    { kind: "development" }
  ]) {
    assert.throws(() => parseDiagnosticsBuildIdentity(invalid), /Invalid Jingle diagnostics/)
  }
})

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

test("diagnostics logger bounds a blocked queue and completes fatal writes first", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({
      logDir,
      maxPendingBytes: 8 * 1024,
      maxPendingRecords: 4,
      maxRecordBytes: 1024,
      rootDir
    })
    let releaseWriter!: () => void
    let writerStarted!: () => void
    const started = new Promise<void>((resolve) => {
      writerStarted = resolve
    })
    const held = logger.runWithWriteLock(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve
          writerStarted()
        })
    )
    await started

    for (let index = 0; index < 100; index += 1) {
      logger.error(`queued-error-${index}`, { fingerprint: `error-${index}` })
    }
    const fatal = logger.errorAndFlush("fatal-after-flood", {
      fingerprint: "fatal-after-flood",
      stateImpact: "process_terminating"
    })
    let fullFlushSettled = false
    const fullFlush = logger.flush().then(() => {
      fullFlushSettled = true
    })
    releaseWriter()
    await held
    await fatal
    assert.equal(fullFlushSettled, false)
    await fullFlush

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.equal(records.length, 5)
    assert.equal(records[0]["message"], "queued-error-0")
    assert.equal(records[1]["message"], "fatal-after-flood")
    assert.equal(records[2]["recordType"], "diagnostic.queue-pressure")
    assert.equal(records[2]["droppedRecords"], 97)
    assert.equal(records[2]["droppedErrorRecords"], 97)
    assert.equal(records[3]["message"], "queued-error-1")
    assert.equal(records[4]["message"], "queued-error-2")
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger admits fatal writes into an active normal batch", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, maxPendingRecords: 4, rootDir })
    const appendOwner = logger as unknown as {
      appendSerializedLine(line: string, bytes: number): Promise<void>
    }
    const appendSerializedLine = appendOwner.appendSerializedLine.bind(logger)
    let releaseActiveWrite!: () => void
    let activeWriteStarted!: () => void
    const activeWrite = new Promise<void>((resolve) => {
      activeWriteStarted = resolve
    })
    appendOwner.appendSerializedLine = async (line, bytes) => {
      const record = JSON.parse(line) as { message?: string }
      if (record.message === "active-leading") {
        await new Promise<void>((resolve) => {
          releaseActiveWrite = resolve
          activeWriteStarted()
        })
      }
      await appendSerializedLine(line, bytes)
    }

    logger.error("active-leading", { fingerprint: "active-leading" })
    await activeWrite
    for (let index = 0; index < 10; index += 1) {
      logger.error(`queued-during-active-${index}`, {
        fingerprint: `queued-during-active-${index}`
      })
    }
    const fatal = logger.errorAndFlush("fatal-during-active-write", {
      fingerprint: "fatal-during-active-write",
      stateImpact: "process_terminating"
    })
    let fullFlushSettled = false
    const fullFlush = logger.flush().then(() => {
      fullFlushSettled = true
    })
    releaseActiveWrite()
    await fatal
    assert.equal(fullFlushSettled, false)
    await fullFlush

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.equal(records[0]["message"], "active-leading")
    assert.equal(records[1]["message"], "fatal-during-active-write")
    assert.equal(records[2]["recordType"], "diagnostic.queue-pressure")
    assert.equal(records[2]["droppedRecords"], 1)
    assert.deepEqual(
      records
        .filter((record) => record["recordType"] !== "diagnostic.queue-pressure")
        .map((record) => record["message"]),
      [
        "active-leading",
        "fatal-during-active-write",
        "queued-during-active-0",
        "queued-during-active-1"
      ]
    )
    assert.equal(records.at(-1)?.["recordType"], "diagnostic.queue-pressure")
    assert.equal(records.at(-1)?.["droppedRecords"], 7)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger admits fatal after the active leading record is consumed", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, maxPendingRecords: 3, rootDir })
    const appendOwner = logger as unknown as {
      appendSerializedLine(line: string, bytes: number): Promise<void>
    }
    const appendSerializedLine = appendOwner.appendSerializedLine.bind(logger)
    let releaseActiveNormal!: () => void
    let releaseFatalWrite!: () => void
    let activeNormalStarted!: () => void
    let fatalWriteStarted!: () => void
    const activeNormal = new Promise<void>((resolve) => {
      activeNormalStarted = resolve
    })
    const fatalWrite = new Promise<void>((resolve) => {
      fatalWriteStarted = resolve
    })
    appendOwner.appendSerializedLine = async (line, bytes) => {
      const record = JSON.parse(line) as { message?: string }
      if (record.message === "active-normal") {
        await new Promise<void>((resolve) => {
          releaseActiveNormal = resolve
          activeNormalStarted()
        })
      }
      if (record.message === "fatal-after-leading") {
        await new Promise<void>((resolve) => {
          releaseFatalWrite = resolve
          fatalWriteStarted()
        })
      }
      await appendSerializedLine(line, bytes)
    }

    logger.error("active-leading", { fingerprint: "active-leading" })
    logger.error("active-normal", { fingerprint: "active-normal" })
    await activeNormal
    const barriers: Promise<void>[] = []
    logger.error("sealed-0", { fingerprint: "sealed-0" })
    barriers.push(logger.runWithWriteLock(async () => undefined))
    logger.error("evicted-open", { fingerprint: "evicted-open" })
    const queueOwner = logger as unknown as {
      activeBatch: { leading: unknown; pendingRecords: number } | null
      openBatch: { pendingRecords: number } | null
      pendingBatches: Set<{ pendingRecords: number }>
    }
    const openBeforeFatal = queueOwner.openBatch
    assert.equal(queueOwner.activeBatch?.leading, null)
    assert.equal(queueOwner.pendingBatches.size, 2)
    assert.equal(openBeforeFatal !== null, true)
    assert.equal(queueOwner.pendingBatches.has(openBeforeFatal as { pendingRecords: number }), true)

    const fatal = logger.errorAndFlush("fatal-after-leading", {
      fingerprint: "fatal-after-leading",
      stateImpact: "process_terminating"
    })
    assert.equal(queueOwner.openBatch, openBeforeFatal)
    assert.equal(queueOwner.openBatch?.pendingRecords, 0)
    assert.equal(queueOwner.pendingBatches.has(openBeforeFatal as { pendingRecords: number }), true)

    releaseActiveNormal()
    await fatalWrite
    logger.error("open-reused", { fingerprint: "open-reused" })
    barriers.push(logger.runWithWriteLock(async () => undefined))
    logger.error("dropped-after-seal", { fingerprint: "dropped-after-seal" })
    const actualPendingRecords =
      (queueOwner.activeBatch?.pendingRecords ?? 0) +
      [...queueOwner.pendingBatches].reduce((total, batch) => total + batch.pendingRecords, 0)
    assert.equal(queueOwner.openBatch, null)
    assert.equal(actualPendingRecords, 3)

    let fullFlushSettled = false
    const fullFlush = logger.flush().then(() => {
      fullFlushSettled = true
    })
    releaseFatalWrite()
    await fatal
    assert.equal(fullFlushSettled, false)
    await fullFlush
    await Promise.all(barriers)

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records
        .filter((record) => record["recordType"] !== "diagnostic.queue-pressure")
        .map((record) => record["message"]),
      ["active-leading", "active-normal", "fatal-after-leading", "sealed-0", "open-reused"]
    )
    const pressure = records.find((record) => record["recordType"] === "diagnostic.queue-pressure")
    assert.equal(pressure?.["droppedRecords"], 2)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger preserves a fatal payload that shares a normal fingerprint", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, rootDir })
    logger.error("ordinary-error", {
      fingerprint: "shared-fingerprint",
      recoverable: true,
      stateImpact: "none"
    })
    await logger.errorAndFlush("fatal-error", {
      fingerprint: "shared-fingerprint",
      recoverable: false,
      stateImpact: "process_terminating"
    })
    await logger.flush()

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records.map((record) => record["message"]),
      ["ordinary-error", "fatal-error"]
    )
    assert.equal(records[1]?.["recoverable"], false)
    assert.equal(records[1]?.["stateImpact"], "process_terminating")
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger rejects a fatal wave when one of its records is evicted", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, maxPendingRecords: 2, rootDir })
    let releaseWriter!: () => void
    let writerStarted!: () => void
    const started = new Promise<void>((resolve) => {
      writerStarted = resolve
    })
    const held = logger.runWithWriteLock(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve
          writerStarted()
        })
    )
    await started

    const first = logger.errorAndFlush("fatal-one", { fingerprint: "fatal-one" })
    const second = logger.errorAndFlush("fatal-two", { fingerprint: "fatal-two" })
    const barrier = logger.runWithWriteLock(async () => undefined)
    const third = logger.errorAndFlush("fatal-three", { fingerprint: "fatal-three" })
    const resultsPromise = Promise.allSettled([first, second, third])
    releaseWriter()
    await held
    const results = await resultsPromise
    await barrier
    assert.deepEqual(
      results.map((result) => result.status),
      ["rejected", "rejected", "fulfilled"]
    )
    await assert.rejects(logger.flush(), /fatal record was evicted before persistence/)

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records
        .filter((record) => record["recordType"] !== "diagnostic.queue-pressure")
        .map((record) => record["message"]),
      ["fatal-two", "fatal-three"]
    )
    const pressure = records.find((record) => record["recordType"] === "diagnostic.queue-pressure")
    assert.equal(pressure?.["droppedRecords"], 1)
    assert.equal(pressure?.["droppedErrorRecords"], 1)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger continues a batch after one append fails", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, rootDir })
    const appendOwner = logger as unknown as {
      appendSerializedLine(line: string, bytes: number): Promise<void>
    }
    const appendSerializedLine = appendOwner.appendSerializedLine.bind(logger)
    let appendCalls = 0
    appendOwner.appendSerializedLine = async (line, bytes) => {
      appendCalls += 1
      if (appendCalls === 2) {
        throw new Error("injected diagnostics append failure")
      }
      await appendSerializedLine(line, bytes)
    }

    logger.error("first-record", { fingerprint: "first-record" })
    logger.error("failed-record", { fingerprint: "failed-record" })
    logger.error("third-record", { fingerprint: "third-record" })
    await assert.rejects(logger.flush(), /injected diagnostics append failure/)

    logger.error("after-recovery", { fingerprint: "after-recovery" })
    await logger.flush()
    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records.map((record) => record["message"]),
      ["first-record", "third-record", "after-recovery"]
    )
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger bounds pending bytes and coalesces repeated fingerprints", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({
      logDir,
      maxPendingBytes: 2048,
      maxPendingRecords: 100,
      maxRecordBytes: 1024,
      rootDir
    })
    let releaseWriter!: () => void
    let writerStarted!: () => void
    const started = new Promise<void>((resolve) => {
      writerStarted = resolve
    })
    const held = logger.runWithWriteLock(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve
          writerStarted()
        })
    )
    await started

    for (let index = 0; index < 20; index += 1) {
      logger.warn(`large-record-${index}`, {
        fingerprint: `large-${index}`,
        payload: "x".repeat(700)
      })
    }
    for (let index = 0; index < 50; index += 1) {
      logger.warn("repeated-record", { fingerprint: "repeated-fingerprint" })
    }
    releaseWriter()
    await held
    await logger.flush()

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const pressure = records.at(-1)
    assert.equal(records.length <= 4, true)
    assert.equal(pressure?.["recordType"], "diagnostic.queue-pressure")
    assert.equal((pressure?.["droppedBytes"] as number) > 0, true)
    assert.equal((pressure?.["droppedRecords"] as number) > 0, true)
    assert.equal((pressure?.["coalescedRecords"] as number) > 0, true)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("diagnostics logger keeps sealed write-lock batches inside the global record cap", async () => {
  const { logDir, rootDir } = createTempLogPaths()
  try {
    const logger = new DiagnosticsLogger({ logDir, maxPendingRecords: 4, rootDir })
    let releaseWriter!: () => void
    let writerStarted!: () => void
    const started = new Promise<void>((resolve) => {
      writerStarted = resolve
    })
    const held = logger.runWithWriteLock(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve
          writerStarted()
        })
    )
    await started

    const barriers: Promise<void>[] = []
    for (let index = 0; index < 50; index += 1) {
      logger.error(`sealed-${index}`, { fingerprint: `sealed-${index}` })
      barriers.push(logger.runWithWriteLock(async () => undefined))
    }
    const queueOwner = logger as unknown as {
      pendingBatches: Set<unknown>
    }
    assert.equal(queueOwner.pendingBatches.size, 4)
    releaseWriter()
    await held
    await Promise.all(barriers)
    await logger.flush()

    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records
        .filter((record) => record["recordType"] !== "diagnostic.queue-pressure")
        .map((record) => record["message"]),
      ["sealed-0", "sealed-1", "sealed-2", "sealed-3"]
    )
    const pressureRecords = records.filter(
      (record) => record["recordType"] === "diagnostic.queue-pressure"
    )
    assert.equal(pressureRecords.length, 1)
    assert.equal(pressureRecords[0]?.["droppedRecords"], 46)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test("renderer error reports are normalized before local logging", () => {
  assert.deepEqual(
    normalizeRendererErrorReport(
      {
        kind: "unhandledrejection",
        message: "  Failed to render  ",
        stack: " stack ",
        source: " app.js ",
        windowKind: " main ",
        extra: "ignored"
      },
      "thread-window"
    ),
    {
      kind: "unhandledrejection",
      message: "Failed to render",
      source: "app.js",
      stack: "stack",
      windowKind: "thread-window"
    }
  )

  assert.deepEqual(normalizeRendererErrorReport({}), {
    kind: "error",
    message: "Renderer error"
  })
})

test("renderer diagnostic transport failures cannot recurse into unhandled rejections", async () => {
  const report = { kind: "error", message: "render failed" } as const
  assert.doesNotThrow(() => {
    sendRendererErrorReport(report, () => {
      throw new Error("sync transport failure")
    })
  })
  sendRendererErrorReport(report, () => Promise.reject(new Error("async transport failure")))
  await new Promise<void>((resolve) => setImmediate(resolve))
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
    formatFatalMainProcessError(error, "/tmp/jingle.log", { kind: "written" }),
    [
      "Object has been destroyed",
      "",
      "Diagnostics were written to: /tmp/jingle.log",
      "",
      "Jingle will quit now. Please restart the app."
    ].join("\n")
  )

  assert.equal(
    formatFatalMainProcessError(error, "/tmp/jingle.log", { kind: "partial" }),
    [
      "Object has been destroyed",
      "",
      "Some diagnostics were written to: /tmp/jingle.log",
      "",
      "Jingle will quit now. Please restart the app."
    ].join("\n")
  )
  assert.equal(
    formatFatalMainProcessError(error, "/tmp/jingle.log", { kind: "failed" }),
    [
      "Object has been destroyed",
      "",
      "Diagnostics could not be confirmed as written before Jingle quit.",
      "",
      "Jingle will quit now. Please restart the app."
    ].join("\n")
  )
  assert.equal(
    formatFatalMainProcessError(error, "/tmp/jingle.log", { kind: "timed_out" }),
    [
      "Object has been destroyed",
      "",
      "Diagnostics did not finish writing before Jingle quit.",
      "",
      "Jingle will quit now. Please restart the app."
    ].join("\n")
  )
})

test("diagnostics singleton requires explicit Electron bootstrap initialization", async () => {
  const { rootDir } = createTempLogPaths()
  const originalJingleHome = process.env.JINGLE_HOME
  process.env.JINGLE_HOME = rootDir

  try {
    const {
      diagnosticsGraph,
      diagnosticsLogger,
      getDiagnosticsSupportPacketRuntimeIdentity,
      initializeDiagnostics,
      startDiagnosticsSession
    } = await import("../../src/main/diagnostics/instance")
    const appLogPaths: string[] = []
    const initialization = {
      appVersion: "3.2.1",
      electronVersion: "37.2.0",
      isPackaged: true,
      platform: process.platform,
      setAppLogsPath: (path: string) => appLogPaths.push(path)
    }
    const expectedLogDir = join(realpathSync(rootDir), "logs")

    assert.equal(diagnosticsLogger.getLogDir(), expectedLogDir)
    assert.throws(
      () => startDiagnosticsSession(),
      new Error("Diagnostics must be initialized before starting a diagnostics session.")
    )

    initializeDiagnostics(initialization)
    assert.deepEqual(getDiagnosticsSupportPacketRuntimeIdentity().sourceRevision, {
      kind: "unavailable",
      reason: "untrusted-build"
    })
    assert.deepEqual(appLogPaths, [expectedLogDir])
    assert.throws(
      () => initializeDiagnostics(initialization),
      new Error("Diagnostics have already been initialized.")
    )
    assert.deepEqual(appLogPaths, [expectedLogDir])

    const session = startDiagnosticsSession()
    assert.equal(startDiagnosticsSession(), session)
    await diagnosticsGraph.flush()

    const records = readFileSync(diagnosticsLogger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const sessionRecord = records.find(
      (record) => record["eventCode"] === "diagnostics.session_started"
    )
    assert.deepEqual(sessionRecord?.["dimensions"], {
      appVersion: "3.2.1",
      electronVersion: "37.2.0",
      isPackaged: true,
      platform: process.platform
    })
  } finally {
    if (originalJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = originalJingleHome
    }
    rmSync(rootDir, { recursive: true, force: true })
  }
})
