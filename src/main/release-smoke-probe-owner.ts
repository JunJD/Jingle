import {
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { join } from "node:path"
import { app, webContents, type WebContents } from "electron"
import { selectReleaseSmokeMainWebContents } from "./release-smoke-main-window"
import type { WindowIdentity } from "./windows/window-identity"

const MAX_FILE_BYTES = 64 * 1024
const PROBE_DEADLINE_MS = 90_000
const REQUEST_FILE_NAME = "release-smoke-probe-request.json"
const RESULT_FILE_NAME = "release-smoke-probe-result.json"

interface SentinelRequest {
  mode: "create" | "verify"
  threadId?: string
  title: string
  token: string
  workspacePath?: string
}

interface ProbeRequest {
  expectedWindowKind: "main"
  schemaVersion: 1
  sentinelRequest: SentinelRequest | null
}

interface RendererGlobal {
  api: {
    settings: { getAppThemeSettings(): Promise<unknown> }
    threads: {
      create(input: unknown): Promise<Record<string, unknown>>
      get(threadId: string): Promise<Record<string, unknown> | null>
      getAgentThreadData(threadId: string): Promise<{ thread: { thread_id: string } }>
      list(): Promise<Array<{ thread_id: string }>>
    }
  }
  document: { body?: { dataset?: { window?: string } }; getElementById(id: string): Element | null }
  electron: { process: { platform: string } }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], owner: string): void {
  const actual = Object.keys(value).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${owner} has unexpected fields`)
  }
}

function readString(value: unknown, owner: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new Error(`${owner} must be a bounded non-empty string`)
  }
  return value
}

function parseProbeRequest(value: unknown): ProbeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("release smoke probe request must be an object")
  }
  const record = value as Record<string, unknown>
  assertExactKeys(record, ["expectedWindowKind", "schemaVersion", "sentinelRequest"], "request")
  if (record.schemaVersion !== 1 || record.expectedWindowKind !== "main") {
    throw new Error("release smoke probe request identity is invalid")
  }
  if (record.sentinelRequest === null) {
    return { expectedWindowKind: "main", schemaVersion: 1, sentinelRequest: null }
  }
  if (
    !record.sentinelRequest ||
    typeof record.sentinelRequest !== "object" ||
    Array.isArray(record.sentinelRequest)
  ) {
    throw new Error("release smoke sentinel request must be an object or null")
  }
  const sentinel = record.sentinelRequest as Record<string, unknown>
  if (sentinel.mode === "create") {
    assertExactKeys(sentinel, ["mode", "title", "token", "workspacePath"], "create sentinel")
    return {
      expectedWindowKind: "main",
      schemaVersion: 1,
      sentinelRequest: {
        mode: "create",
        title: readString(sentinel.title, "sentinel title"),
        token: readString(sentinel.token, "sentinel token"),
        workspacePath: readString(sentinel.workspacePath, "sentinel workspacePath")
      }
    }
  }
  if (sentinel.mode === "verify") {
    assertExactKeys(sentinel, ["mode", "threadId", "title", "token"], "verify sentinel")
    return {
      expectedWindowKind: "main",
      schemaVersion: 1,
      sentinelRequest: {
        mode: "verify",
        threadId: readString(sentinel.threadId, "sentinel threadId"),
        title: readString(sentinel.title, "sentinel title"),
        token: readString(sentinel.token, "sentinel token")
      }
    }
  }
  throw new Error("release smoke sentinel mode is invalid")
}

function readRequest(path: string): ProbeRequest {
  const entry = lstatSync(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0 || entry.size > MAX_FILE_BYTES) {
    throw new Error("release smoke probe request file is invalid")
  }
  return parseProbeRequest(JSON.parse(readFileSync(path, "utf8")) as unknown)
}

function describeError(error: unknown): { message: string; name: string } {
  const resolved = error instanceof Error ? error : new Error(String(error))
  return { message: resolved.message.slice(0, 4096), name: resolved.name.slice(0, 128) }
}

function writeResult(path: string, result: unknown): void {
  const temporaryPath = `${path}.${process.pid}.tmp`
  const bytes = JSON.stringify(result)
  if (Buffer.byteLength(bytes, "utf8") > MAX_FILE_BYTES) {
    throw new Error("release smoke probe result exceeded its byte budget")
  }
  const descriptor = openSync(temporaryPath, "wx", 0o600)
  try {
    writeFileSync(descriptor, bytes, "utf8")
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporaryPath, path)
}

async function runRendererProbe(sentinelRequest: SentinelRequest | null): Promise<unknown> {
  const runtime = globalThis as unknown as RendererGlobal
  const [theme, threads] = await Promise.all([
    runtime.api.settings.getAppThemeSettings(),
    runtime.api.threads.list()
  ])
  let sentinelThread: Record<string, unknown> | null = null
  if (sentinelRequest?.mode === "create") {
    const created = await runtime.api.threads.create({
      metadata: {
        releaseSmokeUpgradeSentinel: {
          schemaVersion: 1,
          sourceVersion: "0.0.1",
          token: sentinelRequest.token
        },
        title: sentinelRequest.title
      },
      workspaceKind: "projectless",
      workspacePath: sentinelRequest.workspacePath
    })
    sentinelThread = {
      metadata: created.metadata ?? null,
      threadId: created.thread_id,
      title: created.title ?? null
    }
  } else if (sentinelRequest?.mode === "verify" && sentinelRequest.threadId) {
    const [persisted, hydrated] = await Promise.all([
      runtime.api.threads.get(sentinelRequest.threadId),
      runtime.api.threads.getAgentThreadData(sentinelRequest.threadId)
    ])
    if (
      !persisted ||
      !threads.some((thread) => thread.thread_id === persisted.thread_id) ||
      hydrated.thread.thread_id !== persisted.thread_id
    ) {
      throw new Error("release upgrade sentinel is not visible through current IPC projections")
    }
    sentinelThread = {
      metadata: persisted.metadata ?? null,
      threadId: persisted.thread_id,
      title: persisted.title ?? null
    }
  }
  return {
    platform: runtime.electron.process.platform,
    rendererReady: (runtime.document.getElementById("root")?.childElementCount ?? 0) > 0,
    sentinelThread,
    themeAvailable: typeof theme === "object" && theme !== null,
    threadCount: threads.length,
    windowKind: runtime.document.body?.dataset?.window ?? null
  }
}

async function executeProbe(
  request: ProbeRequest,
  getWindowIdentity: (contents: WebContents) => WindowIdentity | null
): Promise<unknown> {
  const deadline = Date.now() + PROBE_DEADLINE_MS
  while (Date.now() < deadline) {
    const contents = selectReleaseSmokeMainWebContents(
      webContents.getAllWebContents(),
      getWindowIdentity
    )
    if (contents) {
      const source = `(${runRendererProbe.toString()})(${JSON.stringify(request.sentinelRequest)})`
      const remaining = Math.max(1, Math.min(20_000, deadline - Date.now()))
      let timer: NodeJS.Timeout | undefined
      try {
        return await Promise.race([
          contents.executeJavaScript(source, true),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("release smoke renderer probe execution timed out")),
              remaining
            )
            timer.unref()
          })
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error("release smoke main renderer did not become ready")
}

export function startReleaseSmokeProbeOwner(
  jingleHome: string,
  recordStage: (stage: string, error?: unknown) => void,
  getWindowIdentity: (contents: WebContents) => WindowIdentity | null
): void {
  const requestPath = join(jingleHome, REQUEST_FILE_NAME)
  const resultPath = join(jingleHome, RESULT_FILE_NAME)
  let running = false
  const timer = setInterval(() => {
    if (running || !existsSync(requestPath)) return
    running = true
    clearInterval(timer)
    void (async () => {
      try {
        const request = readRequest(requestPath)
        unlinkSync(requestPath)
        recordStage("probe_requested")
        const probe = await executeProbe(request, getWindowIdentity)
        writeResult(resultPath, { ok: true, probe, schemaVersion: 1 })
        recordStage("probe_completed")
      } catch (error) {
        try {
          writeResult(resultPath, { error: describeError(error), ok: false, schemaVersion: 1 })
          recordStage("probe_failed", error)
        } catch (publicationError) {
          const aggregate = new AggregateError(
            [error, publicationError],
            "release smoke probe and result publication both failed"
          )
          recordStage("probe_result_failed", aggregate)
          setImmediate(() => {
            throw aggregate
          })
        }
      }
    })()
  }, 50)
  timer.unref()
  app.once("before-quit", () => clearInterval(timer))
  recordStage("probe_owner_started")
}
