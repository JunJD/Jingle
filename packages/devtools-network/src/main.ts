import { performance } from "node:perf_hooks"
import type {
  BrowserWindow,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents
} from "electron"
import type {
  DevtoolsNetworkDirection,
  DevtoolsNetworkEntry,
  DevtoolsNetworkErrorSummary,
  DevtoolsNetworkPattern,
  DevtoolsNetworkSource,
  DevtoolsNetworkStatus,
  DevtoolsNetworkValueSummary,
  IpcNetworkInternalChannel
} from "./protocol"
import { IPC_NETWORK_INTERNAL_CHANNELS } from "./protocol"

const DEFAULT_MAX_ENTRIES = 1000
const MAX_OBJECT_DEPTH = 4
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 40
const MAX_STRING_LENGTH = 240
const SENSITIVE_KEY_PATTERN = /api[-_]?key|authorization|credential|password|secret|token/i

export interface DevtoolsNetworkRecorderOptions {
  readonly enabled: boolean
  readonly maxEntries?: number
}

interface IpcNetworkRecordStartInput {
  readonly args: readonly unknown[]
  readonly channel: string
  readonly direction: DevtoolsNetworkDirection
  readonly pattern: DevtoolsNetworkPattern
  readonly webContentsId?: number
}

export interface DevtoolsNetworkAppendEventInput {
  readonly channel: string
  readonly direction?: DevtoolsNetworkDirection
  readonly durationMs?: number
  readonly error?: unknown
  readonly metadata?: Record<string, unknown>
  readonly pattern?: DevtoolsNetworkPattern
  readonly payload?: unknown
  readonly result?: unknown
  readonly source: Exclude<DevtoolsNetworkSource, "ipc"> | DevtoolsNetworkSource
  readonly status: DevtoolsNetworkStatus
  readonly webContentsId?: number
}

interface MutableIpcNetworkEntry {
  args?: DevtoolsNetworkEntry["args"]
  channel: string
  completedAt?: string
  direction: DevtoolsNetworkDirection
  durationMs?: number
  error?: DevtoolsNetworkErrorSummary
  id: string
  metadata?: DevtoolsNetworkValueSummary
  pattern: DevtoolsNetworkPattern
  payload?: DevtoolsNetworkValueSummary
  result?: DevtoolsNetworkValueSummary
  sequence: number
  source: DevtoolsNetworkSource
  startedAt: string
  startedAtMs: number
  status: DevtoolsNetworkStatus
  webContentsId?: number
}

export interface IpcNetworkSpan {
  fail(error: unknown): void
  markSent(): void
  succeed(result?: unknown): void
}

interface SummaryState {
  readonly seen: WeakSet<object>
  truncated: boolean
}

function summarizeError(error: unknown): DevtoolsNetworkErrorSummary {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name
    }
  }

  return {
    message: String(error),
    name: "Error"
  }
}

function summarizeString(value: string, state: SummaryState): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value
  }

  state.truncated = true
  return `${value.slice(0, MAX_STRING_LENGTH)}...`
}

function summarizeValue(value: unknown, state: SummaryState, depth: number, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]"
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return summarizeString(value, state)
  }

  if (typeof value === "undefined") {
    return "[undefined]"
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`
  }

  if (value instanceof Error) {
    return summarizeError(value)
  }

  if (depth >= MAX_OBJECT_DEPTH) {
    state.truncated = true
    return "[truncated]"
  }

  if (Array.isArray(value)) {
    if (state.seen.has(value)) {
      state.truncated = true
      return "[circular]"
    }

    state.seen.add(value)
    if (value.length > MAX_ARRAY_ITEMS) {
      state.truncated = true
    }
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, state, depth + 1))
  }

  if (typeof value === "object") {
    if (state.seen.has(value)) {
      state.truncated = true
      return "[circular]"
    }

    state.seen.add(value)
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > MAX_OBJECT_KEYS) {
      state.truncated = true
    }

    return Object.fromEntries(
      entries
        .slice(0, MAX_OBJECT_KEYS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          summarizeValue(entryValue, state, depth + 1, entryKey)
        ])
    )
  }

  return String(value)
}

export function summarizeDevtoolsNetworkValue(value: unknown): DevtoolsNetworkValueSummary {
  const state: SummaryState = {
    seen: new WeakSet<object>(),
    truncated: false
  }

  return {
    preview: summarizeValue(value, state, 0),
    truncated: state.truncated
  }
}

export class DevtoolsNetworkRecorder {
  private enabled = false
  private entries: MutableIpcNetworkEntry[] = []
  private maxEntries = DEFAULT_MAX_ENTRIES
  private nextSequence = 1

  configure(options: DevtoolsNetworkRecorderOptions): void {
    this.enabled = options.enabled
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!this.enabled) {
      this.clear()
    }
  }

  clear(): void {
    this.entries = []
  }

  isEnabled(): boolean {
    return this.enabled
  }

  list(): DevtoolsNetworkEntry[] {
    return this.entries.map(({ startedAtMs: _startedAtMs, ...entry }) => ({ ...entry }))
  }

  append(input: DevtoolsNetworkAppendEventInput): DevtoolsNetworkEntry | null {
    if (!this.enabled) {
      return null
    }

    const sequence = this.nextSequence
    this.nextSequence += 1
    const now = new Date().toISOString()
    const entry: MutableIpcNetworkEntry = {
      channel: input.channel,
      completedAt: now,
      direction: input.direction ?? "internal",
      id: `ipc-${sequence}`,
      pattern: input.pattern ?? "record",
      sequence,
      source: input.source,
      startedAt: now,
      startedAtMs: performance.now(),
      status: input.status,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.error !== undefined ? { error: summarizeError(input.error) } : {}),
      ...(input.metadata ? { metadata: summarizeIpcNetworkValue(input.metadata) } : {}),
      ...(input.payload !== undefined ? { payload: summarizeIpcNetworkValue(input.payload) } : {}),
      ...(input.result !== undefined ? { result: summarizeIpcNetworkValue(input.result) } : {}),
      ...(input.webContentsId !== undefined ? { webContentsId: input.webContentsId } : {})
    }

    this.entries.push(entry)
    this.trim()
    const { startedAtMs: _startedAtMs, ...publicEntry } = entry
    return { ...publicEntry }
  }

  start(input: IpcNetworkRecordStartInput): IpcNetworkSpan | null {
    if (!this.enabled) {
      return null
    }

    const sequence = this.nextSequence
    this.nextSequence += 1

    const entry: MutableIpcNetworkEntry = {
      args: input.args.map(summarizeDevtoolsNetworkValue),
      channel: input.channel,
      direction: input.direction,
      id: `ipc-${sequence}`,
      pattern: input.pattern,
      sequence,
      source: "ipc",
      startedAt: new Date().toISOString(),
      startedAtMs: performance.now(),
      status: "pending",
      ...(input.webContentsId !== undefined ? { webContentsId: input.webContentsId } : {})
    }

    this.entries.push(entry)
    this.trim()

    return {
      fail: (error: unknown) => {
        this.complete(entry, "error", {
          error: summarizeError(error)
        })
      },
      markSent: () => {
        this.complete(entry, "sent")
      },
      succeed: (result?: unknown) => {
        this.complete(entry, "success", {
          result: summarizeDevtoolsNetworkValue(result)
        })
      }
    }
  }

  private complete(
    entry: MutableIpcNetworkEntry,
    status: Exclude<DevtoolsNetworkStatus, "pending">,
    details: Pick<MutableIpcNetworkEntry, "error" | "result"> = {}
  ): void {
    if (entry.status !== "pending") {
      return
    }

    const completedAtMs = performance.now()
    entry.completedAt = new Date().toISOString()
    entry.durationMs = Math.max(0, Math.round((completedAtMs - entry.startedAtMs) * 100) / 100)
    entry.status = status
    if (details.error) {
      entry.error = details.error
    }
    if (details.result) {
      entry.result = details.result
    }
  }

  private trim(): void {
    const overflow = this.entries.length - this.maxEntries
    if (overflow > 0) {
      this.entries.splice(0, overflow)
    }
  }
}

const devtoolsNetworkRecorder = new DevtoolsNetworkRecorder()
const patchedIpcMainObjects = new WeakSet<Pick<IpcMain, "handle" | "on">>()
const patchedWebContents = new WeakSet<Pick<WebContents, "id" | "send">>()
const internalChannels = new Set<string>(IPC_NETWORK_INTERNAL_CHANNELS)

export function configureDevtoolsNetworkRecorder(options: DevtoolsNetworkRecorderOptions): void {
  devtoolsNetworkRecorder.configure(options)
}

export function getDevtoolsNetworkRecorder(): DevtoolsNetworkRecorder {
  return devtoolsNetworkRecorder
}

function shouldRecordChannel(channel: string): boolean {
  return !internalChannels.has(channel as IpcNetworkInternalChannel)
}

export function installIpcMainNetworkInstrumentation(
  ipcMain: Pick<IpcMain, "handle" | "on">
): void {
  if (patchedIpcMainObjects.has(ipcMain)) {
    return
  }

  patchedIpcMainObjects.add(ipcMain)
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ) => {
    return originalHandle(channel, async (event, ...args) => {
      if (!shouldRecordChannel(channel)) {
        return listener(event, ...args)
      }

      const span = devtoolsNetworkRecorder.start({
        args,
        channel,
        direction: "renderer-to-main",
        pattern: "invoke",
        webContentsId: event.sender.id
      })

      try {
        const result = await listener(event, ...args)
        span?.succeed(result)
        return result
      } catch (error) {
        span?.fail(error)
        throw error
      }
    })
  }) as IpcMain["handle"]

  const originalOn = ipcMain.on.bind(ipcMain)
  ipcMain.on = ((channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void) => {
    return originalOn(channel, (event, ...args) => {
      if (!shouldRecordChannel(channel)) {
        listener(event, ...args)
        return
      }

      const span = devtoolsNetworkRecorder.start({
        args,
        channel,
        direction: "renderer-to-main",
        pattern: "send",
        webContentsId: event.sender.id
      })

      try {
        listener(event, ...args)
        span?.markSent()
      } catch (error) {
        span?.fail(error)
        throw error
      }
    })
  }) as IpcMain["on"]
}

export function installWebContentsNetworkInstrumentation(
  webContents: Pick<WebContents, "id" | "send">
): void {
  if (patchedWebContents.has(webContents)) {
    return
  }

  patchedWebContents.add(webContents)
  const originalSend = webContents.send.bind(webContents)
  webContents.send = ((channel: string, ...args: unknown[]) => {
    if (!shouldRecordChannel(channel)) {
      originalSend(channel, ...args)
      return
    }

    const span = devtoolsNetworkRecorder.start({
      args,
      channel,
      direction: "main-to-renderer",
      pattern: "send",
      webContentsId: webContents.id
    })

    try {
      originalSend(channel, ...args)
      span?.markSent()
    } catch (error) {
      span?.fail(error)
      throw error
    }
  }) as WebContents["send"]
}

export type IpcNetworkAppendEventInput = DevtoolsNetworkAppendEventInput
export type IpcNetworkRecorderOptions = DevtoolsNetworkRecorderOptions
export const IpcNetworkRecorder = DevtoolsNetworkRecorder
export const configureIpcNetworkRecorder = configureDevtoolsNetworkRecorder
export const getIpcNetworkRecorder = getDevtoolsNetworkRecorder
export const summarizeIpcNetworkValue = summarizeDevtoolsNetworkValue

export function installBrowserWindowIpcNetworkInstrumentation(params: {
  readonly app: {
    on(
      event: "browser-window-created",
      listener: (event: unknown, window: BrowserWindow) => void
    ): void
  }
  readonly windows: {
    getAllWindows(): BrowserWindow[]
  }
}): void {
  for (const window of params.windows.getAllWindows()) {
    installWebContentsNetworkInstrumentation(window.webContents)
  }

  params.app.on("browser-window-created", (_event, window) => {
    installWebContentsNetworkInstrumentation(window.webContents)
  })
}
