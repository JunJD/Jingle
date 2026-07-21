import assert from "node:assert/strict"
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { DiagnosticsGraphRecorder } from "../../src/main/diagnostics/graph"
import { DiagnosticsLogger } from "../../src/main/diagnostics/logger"
import { DiagnosticsProcessSession } from "../../src/main/diagnostics/process-session"
import {
  createDiagnosticSupportPacket,
  DiagnosticSupportPacketError,
  type DiagnosticSupportPacketV1
} from "../../src/main/diagnostics/support-packet"
import { registerWindowIdentity } from "../../src/main/windows/window-identity"

const SECRET = "sk-proj-support-packet-secret"
const PRIVATE_PATH = "/Users/customer/private/project.txt"

function createTempDirectory(label: string): string {
  const path = join(tmpdir(), `jingle-support-packet-${label}-${Date.now()}-${Math.random()}`)
  mkdirSync(path, { mode: 0o700, recursive: true })
  if (process.platform !== "win32") chmodSync(path, 0o700)
  return path
}

function createSource(label: string): {
  graph: DiagnosticsGraphRecorder
  logDir: string
  logger: DiagnosticsLogger
  root: string
} {
  const root = createTempDirectory(label)
  const logDir = join(root, "logs")
  const logger = new DiagnosticsLogger({ logDir, rootDir: root })
  const graph = new DiagnosticsGraphRecorder({ logger, sessionId: `support-${label}` })
  return { graph, logDir, logger, root }
}

function runtimeIdentity() {
  return {
    appVersion: "1.2.3",
    electronVersion: "37.2.0",
    isPackaged: true,
    platform: process.platform,
    sourceRevision: {
      kind: "available",
      provenance: "build-declared",
      value: "a".repeat(40)
    }
  } as const
}

function readOnlyPacket(destination: string): { packet: DiagnosticSupportPacketV1; path: string } {
  const names = readdirSync(destination).filter((name) => name.startsWith("jingle-support-"))
  assert.equal(names.length, 1)
  const path = join(destination, names[0])
  return { packet: JSON.parse(readFileSync(path, "utf8")) as DiagnosticSupportPacketV1, path }
}

test("support packet exports only redacted causal records and their verified evidence", async () => {
  const source = createSource("happy")
  const destination = createTempDirectory("happy-output")
  try {
    source.graph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.session_started",
      level: "info",
      operation: "start-session",
      recoverable: true,
      stateImpact: "none",
      summary: "Diagnostics started"
    })
    source.graph.capture({
      component: "electron",
      eventCode: "process.fatal_error",
      evidence: [
        {
          contentType: "application/json",
          kind: "error",
          value: { message: `${SECRET} at ${PRIVATE_PATH}` }
        }
      ],
      level: "error",
      operation: "observe-main-process",
      recoverable: false,
      refs: [{ id: "main", kind: "process" }],
      stateImpact: "process_terminating",
      summary: "Main process failed"
    })
    await source.graph.flush()
    writeFileSync(join(source.logDir, "electron-debug.log"), `${SECRET} ${PRIVATE_PATH}`, {
      mode: 0o600
    })
    writeFileSync(
      source.logger.getLogFilePath(),
      `${readFileSync(source.logger.getLogFilePath(), "utf8")}{"message":"legacy"}\n`,
      {
        mode: 0o600
      }
    )

    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-happy",
      now: () => new Date("2026-07-20T12:00:00.000Z"),
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.deepEqual(result, {
      coverage: "causal-events-observed",
      eventCount: 2,
      evidenceCount: 1,
      gapCount: 1,
      kind: "exported",
      packetId: "packet-happy"
    })

    const { packet, path } = readOnlyPacket(destination)
    assert.equal(packet.kind, "jingle-diagnostic-support-packet")
    assert.equal(packet.manifest.sourceRevision.kind, "available")
    assert.deepEqual(packet.manifest.gaps, [{ code: "legacy-record", count: 1 }])
    assert.equal(
      packet.events.every((event) => event.recordType === "diagnostic.event"),
      true
    )
    assert.equal(packet.evidence.length, 1)
    const exported = readFileSync(path, "utf8")
    assert.doesNotMatch(exported, new RegExp(SECRET))
    assert.doesNotMatch(exported, /Users\/customer/)
    assert.doesNotMatch(exported, /electron-debug/)
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600)
      assert.equal(statSync(path).nlink, 1)
      assert.equal(readdirSync(destination).length, 1)
    }
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet preserves an untrusted build without inventing a source revision", async () => {
  const source = createSource("untrusted-build")
  const destination = createTempDirectory("untrusted-build-output")
  try {
    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-untrusted-build",
      runtimeIdentity: {
        ...runtimeIdentity(),
        sourceRevision: { kind: "unavailable", reason: "untrusted-build" }
      },
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    assert.deepEqual(readOnlyPacket(destination).packet.manifest.sourceRevision, {
      kind: "unavailable",
      reason: "untrusted-build"
    })
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet carries the causal previous-session abrupt classification", async () => {
  const source = createSource("process-session")
  const destination = createTempDirectory("process-session-output")
  const context = {
    appVersion: "1.2.3",
    electronVersion: "37.2.0",
    isPackaged: true,
    platform: process.platform
  }
  try {
    const first = new DiagnosticsProcessSession({
      idFactory: () => "66666666-6666-4666-8666-666666666666",
      logDir: source.logDir,
      now: () => new Date("2026-07-21T03:00:00.000Z"),
      sink: source.graph
    })
    assert.equal(first.start(context).previousOutcome, "none")
    const second = new DiagnosticsProcessSession({
      idFactory: () => "77777777-7777-4777-8777-777777777777",
      logDir: source.logDir,
      now: () => new Date("2026-07-21T03:01:00.000Z"),
      sink: source.graph
    })
    assert.equal(second.start(context).previousOutcome, "abrupt_exit_unclassified")
    assert.equal(second.markCleanExit({ captureEvent: false }), true)
    const third = new DiagnosticsProcessSession({
      idFactory: () => "88888888-8888-4888-8888-888888888888",
      logDir: source.logDir,
      now: () => new Date("2026-07-21T03:01:30.000Z"),
      sink: source.graph
    })
    assert.equal(third.start(context).previousOutcome, "clean_exit")
    await source.graph.flush()

    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-process-session",
      now: () => new Date("2026-07-21T03:02:00.000Z"),
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    const packet = readOnlyPacket(destination).packet
    const abrupt = packet.events.find(
      (event) => event.eventCode === "process.previous_session_abrupt_exit_unclassified"
    )
    const current = packet.events.find(
      (event) =>
        event.eventCode === "diagnostics.session_started" &&
        event.parentEventIds.includes(abrupt?.eventId ?? "")
    )
    assert.ok(abrupt)
    assert.ok(current)
    assert.equal(abrupt.evidenceRefs.length, 0)
    assert.deepEqual(abrupt.refs, [{ id: "main", kind: "process" }])
    const clean = packet.events.find(
      (event) => event.eventCode === "process.previous_session_clean_exit"
    )
    const afterClean = packet.events.find(
      (event) =>
        event.eventCode === "diagnostics.session_started" &&
        event.parentEventIds.includes(clean?.eventId ?? "")
    )
    assert.ok(clean)
    assert.ok(afterClean)
    assert.equal(clean.evidenceRefs.length, 0)
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet exposes missing retained evidence as a typed gap", async () => {
  const source = createSource("missing-evidence")
  const destination = createTempDirectory("missing-evidence-output")
  try {
    source.graph.capture({
      component: "electron",
      eventCode: "process.fatal_error",
      evidence: [{ kind: "error", value: { message: "bounded failure" } }],
      level: "error",
      operation: "observe-main-process",
      recoverable: false,
      stateImpact: "process_terminating",
      summary: "Main process failed"
    })
    await source.graph.flush()
    const journal = readFileSync(source.logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { evidenceRefs?: Array<{ sha256: string }> })
    const sha256 = journal[0].evidenceRefs?.[0]?.sha256
    assert.ok(sha256)
    rmSync(join(source.logDir, "blobs", "sha256", sha256.slice(0, 2), `${sha256}.json`))

    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-missing",
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    if (result.kind === "exported") {
      assert.equal(result.evidenceCount, 0)
      assert.equal(result.gapCount, 1)
    }
    assert.deepEqual(readOnlyPacket(destination).packet.manifest.gaps, [
      { code: "missing-evidence", count: 1 }
    ])
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet rejects graph envelopes that fail the second redaction boundary", async () => {
  const source = createSource("envelope-redaction")
  const destination = createTempDirectory("envelope-redaction-output")
  try {
    source.graph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.valid_event",
      level: "info",
      operation: "record-valid-event",
      recoverable: true,
      stateImpact: "none",
      summary: "Valid event"
    })
    source.graph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.tampered_event",
      level: "error",
      operation: "record-tampered-event",
      recoverable: false,
      stateImpact: "process_terminating",
      summary: "Tampered event"
    })
    await source.graph.flush()
    const records = readFileSync(source.logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    records[1]["operation"] = SECRET
    records[1]["stateImpact"] = PRIVATE_PATH
    writeFileSync(
      source.logger.getLogFilePath(),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      { mode: 0o600 }
    )

    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-envelope-redaction",
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    const { packet, path } = readOnlyPacket(destination)
    assert.equal(packet.events.length, 1)
    assert.deepEqual(packet.manifest.gaps, [{ code: "incompatible-graph-record", count: 1 }])
    const exported = readFileSync(path, "utf8")
    assert.doesNotMatch(exported, new RegExp(SECRET))
    assert.doesNotMatch(exported, /Users\/customer/)
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet distinguishes failed evidence and invalid parent edge gaps", async () => {
  const source = createSource("typed-gaps")
  const destination = createTempDirectory("typed-gaps-output")
  const otherGraph = new DiagnosticsGraphRecorder({
    logger: source.logger,
    sessionId: "support-typed-gaps-other"
  })
  try {
    const first = source.graph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.first_event",
      evidence: [{ kind: "error", value: { message: "bounded failure" } }],
      level: "info",
      operation: "record-first-event",
      recoverable: true,
      stateImpact: "none",
      summary: "First event"
    })
    const second = source.graph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.second_event",
      level: "info",
      operation: "record-second-event",
      recoverable: true,
      stateImpact: "none",
      summary: "Second event"
    })
    const other = otherGraph.capture({
      component: "diagnostics",
      eventCode: "diagnostics.other_event",
      level: "info",
      operation: "record-other-event",
      recoverable: true,
      stateImpact: "none",
      summary: "Other event"
    })
    await source.graph.flush()
    await otherGraph.flush()
    const records = readFileSync(source.logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const firstRecord = records.find((record) => record["eventId"] === first.eventId)
    const secondRecord = records.find((record) => record["eventId"] === second.eventId)
    const otherRecord = records.find((record) => record["eventId"] === other.eventId)
    assert.ok(firstRecord)
    assert.ok(secondRecord)
    assert.ok(otherRecord)
    const evidenceRefs = firstRecord["evidenceRefs"] as Array<Record<string, unknown>>
    evidenceRefs[0]["capture"] = "failed"
    secondRecord["parentEventIds"] = [first.eventId, first.eventId, other.eventId, second.eventId]
    otherRecord["parentEventIds"] = ["diag:support-missing:1"]
    writeFileSync(
      source.logger.getLogFilePath(),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      { mode: 0o600 }
    )

    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-typed-gaps",
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    if (result.kind === "exported") {
      assert.equal(result.evidenceCount, 0)
      assert.equal(result.gapCount, 5)
    }
    const packet = readOnlyPacket(destination).packet
    assert.deepEqual(packet.manifest.gaps, [
      { code: "cross-session-parent-edge", count: 1 },
      { code: "duplicate-parent-edge", count: 1 },
      { code: "evidence-capture-failed", count: 1 },
      { code: "missing-parent-edge", count: 1 },
      { code: "non-past-parent-edge", count: 1 }
    ])
    assert.deepEqual(
      packet.events.find((event) => event.eventId === second.eventId)?.parentEventIds,
      [first.eventId]
    )
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet fails closed for unsafe source permissions and symlinks", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX permission and symlink contract")
    return
  }
  const source = createSource("unsafe")
  const destination = createTempDirectory("unsafe-output")
  try {
    source.logger.info("private record")
    await source.logger.flush()
    chmodSync(source.logger.getLogFilePath(), 0o644)
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destination,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "source_unsafe"
    )

    chmodSync(source.logger.getLogFilePath(), 0o600)
    const realLogs = join(source.root, "real-logs")
    renameSync(source.logDir, realLogs)
    symlinkSync(realLogs, source.logDir, "dir")
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destination,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "source_unsafe"
    )
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet fails closed when retained journal bounds are exceeded", async () => {
  const source = createSource("bounds")
  const destination = createTempDirectory("bounds-output")
  try {
    for (let index = 0; index < 7; index += 1) {
      writeFileSync(join(source.logDir, index === 0 ? "jingle.log" : `jingle.log.${index}`), "", {
        mode: 0o600
      })
    }
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destination,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "bounds_exceeded"
    )
    assert.deepEqual(readdirSync(destination), [])
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet preserves typed unavailable and invalid-revision failures", async () => {
  const source = createSource("typed-failures")
  const destination = createTempDirectory("typed-failures-output")
  try {
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: join(destination, "missing"),
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "destination_unavailable"
    )
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destination,
        runtimeIdentity: {
          ...runtimeIdentity(),
          sourceRevision: {
            kind: "available",
            provenance: "build-declared",
            value: "not-a-revision"
          }
        },
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "integrity_failed"
    )
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destination,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: join(source.root, "missing-logs"),
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "source_unavailable"
    )
    assert.deepEqual(readdirSync(destination), [])
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
  }
})

test("support packet fails closed before filesystem access when Windows ACLs are unverified", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows-only ACL boundary")
    return
  }
  await assert.rejects(
    createDiagnosticSupportPacket({
      destinationDirectory: "Z:\\untrusted-destination",
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: "Z:\\untrusted-home\\logs",
      sourceRootDirectory: "Z:\\untrusted-home"
    }),
    (error: unknown) =>
      error instanceof DiagnosticSupportPacketError && error.code === "platform_unavailable"
  )
})

test("support packet rejects a symlinked or source-owned destination", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX symlink contract")
    return
  }
  const source = createSource("destination")
  const destinationParent = createTempDirectory("destination-parent")
  const destinationTarget = createTempDirectory("destination-target")
  const destinationLink = join(destinationParent, "linked-output")
  try {
    source.graph.capture({
      component: "electron",
      eventCode: "electron.renderer_process_gone",
      level: "error",
      operation: "observe-renderer-process",
      recoverable: true,
      stateImpact: "window_terminated",
      summary: "Renderer process exited"
    })
    await source.graph.flush()
    symlinkSync(destinationTarget, destinationLink, "dir")
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destinationLink,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "destination_unsafe"
    )
    chmodSync(destinationTarget, 0o755)
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: destinationTarget,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "destination_unsafe"
    )
    chmodSync(destinationTarget, 0o700)
    await assert.rejects(
      createDiagnosticSupportPacket({
        destinationDirectory: source.root,
        runtimeIdentity: runtimeIdentity(),
        sourceLogDirectory: source.logDir,
        sourceRootDirectory: source.root
      }),
      (error: unknown) =>
        error instanceof DiagnosticSupportPacketError && error.code === "destination_unsafe"
    )
    assert.deepEqual(readdirSync(destinationTarget), [])
  } finally {
    rmSync(source.root, { force: true, recursive: true })
    rmSync(destinationParent, { force: true, recursive: true })
    rmSync(destinationTarget, { force: true, recursive: true })
  }
})

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  invoke(
    channel: string,
    sender: FakeWebContents,
    senderFrame: object = sender.mainFrame,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler)
    return Promise.resolve(
      handler({ sender, senderFrame } as unknown as IpcMainInvokeEvent, ...args)
    )
  }
}

class FakeWebContents {
  private static nextId = 40

  readonly id = FakeWebContents.nextId++
  readonly mainFrame = {}

  isDestroyed(): boolean {
    return false
  }
}

test("renderer error IPC exports a redacted causal event with main-owned identity", async () => {
  const testHome = createTempDirectory("renderer-controller-home")
  const destination = createTempDirectory("renderer-controller-output")
  const source = createSource("renderer-controller")
  const originalHome = process.env.JINGLE_HOME
  process.env.JINGLE_HOME = testHome
  try {
    const { registerDiagnosticsIpcHandlers } = await import("../../src/main/diagnostics/controller")
    const ipcMain = new FakeIpcMain()
    registerDiagnosticsIpcHandlers(ipcMain as unknown as IpcMain, {
      exportPacket: async () => ({
        coverage: "empty",
        eventCount: 0,
        evidenceCount: 0,
        gapCount: 0,
        kind: "exported",
        packetId: "unused"
      }),
      graph: source.graph,
      logger: source.logger,
      selectDestinationDirectory: async () => null
    })

    const main = new FakeWebContents()
    registerWindowIdentity(main as unknown as WebContents, {
      kind: "main",
      threadId: "thread-main",
      windowId: "window-main"
    })
    await ipcMain.invoke("diagnostics:reportRendererError", main, main.mainFrame, {
      kind: "unhandledrejection",
      message: `${SECRET} ${PRIVATE_PATH}`,
      source: `${SECRET} renderer.js`,
      stack: `${PRIVATE_PATH}:1`,
      windowKind: "settings"
    })

    const unregistered = new FakeWebContents()
    await assert.rejects(
      ipcMain.invoke("diagnostics:reportRendererError", unregistered, unregistered.mainFrame, {}),
      /registered window main frame/
    )
    await assert.rejects(
      ipcMain.invoke("diagnostics:reportRendererError", main, {}, {}),
      /registered window main frame/
    )

    await source.graph.flush()
    const result = await createDiagnosticSupportPacket({
      destinationDirectory: destination,
      idFactory: () => "packet-renderer-controller",
      now: () => new Date("2026-07-21T00:00:00.000Z"),
      runtimeIdentity: runtimeIdentity(),
      sourceLogDirectory: source.logDir,
      sourceRootDirectory: source.root
    })
    assert.equal(result.kind, "exported")
    const { packet } = readOnlyPacket(destination)
    assert.equal(packet.events.length, 1)
    assert.equal(packet.events[0]?.eventCode, "renderer.unhandled_rejection")
    assert.deepEqual(packet.events[0]?.dimensions, {
      kind: "unhandledrejection",
      windowKind: "main"
    })
    assert.deepEqual(packet.events[0]?.refs, [
      { id: "window-main", kind: "window" },
      { id: String(main.id), kind: "web-contents" }
    ])
    assert.equal(packet.events[0]?.evidenceRefs.length, 0)
    const serializedPacket = JSON.stringify(packet)
    assert.equal(serializedPacket.includes(SECRET), false)
    assert.equal(serializedPacket.includes(PRIVATE_PATH), false)
    assert.equal(serializedPacket.includes("settings"), false)
  } finally {
    if (originalHome === undefined) delete process.env.JINGLE_HOME
    else process.env.JINGLE_HOME = originalHome
    rmSync(testHome, { force: true, recursive: true })
    rmSync(destination, { force: true, recursive: true })
    rmSync(source.root, { force: true, recursive: true })
  }
})

test("support packet IPC admits only the registered Settings main frame before the picker", async () => {
  const testHome = createTempDirectory("controller-home")
  const originalHome = process.env.JINGLE_HOME
  process.env.JINGLE_HOME = testHome
  try {
    const { registerDiagnosticsIpcHandlers } = await import("../../src/main/diagnostics/controller")
    const pickerCalls: IpcMainInvokeEvent[] = []
    const exportDestinations: string[] = []
    const ipcMain = new FakeIpcMain()
    registerDiagnosticsIpcHandlers(ipcMain as unknown as IpcMain, {
      exportPacket: async (destinationDirectory) => {
        exportDestinations.push(destinationDirectory)
        return {
          coverage: "empty",
          eventCount: 0,
          evidenceCount: 0,
          gapCount: 0,
          kind: "exported",
          packetId: "packet-controller"
        }
      },
      selectDestinationDirectory: async (event) => {
        pickerCalls.push(event)
        return "/main-owned/destination"
      }
    })

    const settings = new FakeWebContents()
    registerWindowIdentity(settings as unknown as WebContents, { kind: "settings" })
    assert.deepEqual(await ipcMain.invoke("diagnostics:exportSupportPacket", settings), {
      coverage: "empty",
      eventCount: 0,
      evidenceCount: 0,
      gapCount: 0,
      kind: "exported",
      packetId: "packet-controller"
    })
    assert.deepEqual(exportDestinations, ["/main-owned/destination"])
    assert.equal(pickerCalls.length, 1)

    const launcher = new FakeWebContents()
    registerWindowIdentity(launcher as unknown as WebContents, { kind: "launcher" })
    await assert.rejects(
      ipcMain.invoke("diagnostics:exportSupportPacket", launcher),
      /only be exported by the Settings main frame/
    )
    await assert.rejects(
      ipcMain.invoke("diagnostics:exportSupportPacket", settings, {}),
      /only be exported by the Settings main frame/
    )
    await assert.rejects(
      ipcMain.invoke(
        "diagnostics:exportSupportPacket",
        settings,
        settings.mainFrame,
        "/renderer-controlled/path"
      ),
      /params validation failed/
    )
    assert.equal(pickerCalls.length, 1)
    assert.deepEqual(exportDestinations, ["/main-owned/destination"])
  } finally {
    if (originalHome === undefined) delete process.env.JINGLE_HOME
    else process.env.JINGLE_HOME = originalHome
    rmSync(testHome, { force: true, recursive: true })
  }
})
