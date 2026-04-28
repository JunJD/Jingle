import { randomUUID } from "crypto"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionRuntimeError,
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeMetrics,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeSessionKind,
  ExtensionRuntimeToHostMessage,
  ExtensionSurfaceSnapshot
} from "@shared/extension-runtime-protocol"
import type { NativeExtensionInvokeRequest } from "@shared/native-extensions"
import type { ExtensionRuntimeProcess, ExtensionRuntimeProcessLauncher } from "./runtime-process"

export type {
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeSessionKind
} from "@shared/extension-runtime-protocol"

type MaybePromise<T> = T | Promise<T>

export interface ExtensionRuntimeStorageParams {
  context: ExtensionRuntimeLaunchContext
  key: string
}

export interface ExtensionRuntimeHostCapabilities {
  getCommandPreferences: (params: {
    commandName: string
    extensionName: string
  }) => MaybePromise<Record<string, unknown>>
  getExtensionPreferences: (extensionName: string) => MaybePromise<Record<string, unknown>>
  getStorageValue: (params: ExtensionRuntimeStorageParams) => MaybePromise<unknown>
  invokeNativeExtension: (request: NativeExtensionInvokeRequest) => Promise<unknown>
  openExtensionSettings: (params: {
    commandName?: string
    extensionName: string
  }) => MaybePromise<void>
  openExternal: (url: string) => Promise<void>
  setStorageValue: (
    params: ExtensionRuntimeStorageParams & { value: unknown }
  ) => MaybePromise<void>
}

export type ExtensionRuntimeRunResult =
  | { sessionId: string; status: "ready" }
  | { error: ExtensionRuntimeError; sessionId: string; status: "error" }

export type ExtensionRuntimeSurfaceListener = (
  surface: ExtensionSurfaceSnapshot,
  session: ExtensionRuntimeSessionInfo
) => void

export type ExtensionRuntimeErrorListener = (error: ExtensionRuntimeSessionError) => void

export interface ExtensionRuntimeManagerOptions {
  createSessionId?: () => string
  host: ExtensionRuntimeHostCapabilities
  onError?: (error: ExtensionRuntimeSessionError) => void
  onMetrics?: (metrics: ExtensionRuntimeMetrics, session: ExtensionRuntimeSessionInfo) => void
  onSurface?: (surface: ExtensionSurfaceSnapshot, session: ExtensionRuntimeSessionInfo) => void
  processLauncher: ExtensionRuntimeProcessLauncher
}

interface RuntimeSession {
  context: ExtensionRuntimeLaunchContext
  disposeListeners: Array<() => void>
  kind: ExtensionRuntimeSessionKind
  process: ExtensionRuntimeProcess
  resolveRunOnce?: (result: ExtensionRuntimeRunResult) => void
  sessionId: string
  stopping: boolean
}

export class ExtensionRuntimeManager {
  private foregroundSession: RuntimeSession | null = null
  private lastError: ExtensionRuntimeSessionError | null = null
  private readonly errorListeners = new Set<ExtensionRuntimeErrorListener>()
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly surfaceListeners = new Set<ExtensionRuntimeSurfaceListener>()

  constructor(private readonly options: ExtensionRuntimeManagerOptions) {}

  dispose(): void {
    for (const session of Array.from(this.sessions.values())) {
      this.stopSession(session)
    }
  }

  getForegroundSession(): ExtensionRuntimeSessionInfo | null {
    return this.foregroundSession ? toSessionInfo(this.foregroundSession) : null
  }

  getLastError(): ExtensionRuntimeSessionError | null {
    return this.lastError
  }

  onError(listener: ExtensionRuntimeErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  onSurface(listener: ExtensionRuntimeSurfaceListener): () => void {
    this.surfaceListeners.add(listener)
    return () => {
      this.surfaceListeners.delete(listener)
    }
  }

  runOnce(context: ExtensionRuntimeLaunchContext): Promise<ExtensionRuntimeRunResult> {
    return new Promise((resolve) => {
      const session = this.startSession("run-once", context)
      session.resolveRunOnce = resolve
    })
  }

  sendEvent(sessionId: string, event: ExtensionRuntimeEvent): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    session.process.postMessage({
      event,
      sessionId,
      type: "event"
    })
    return true
  }

  startForeground(context: ExtensionRuntimeLaunchContext): ExtensionRuntimeSessionInfo {
    if (this.foregroundSession) {
      this.stopSession(this.foregroundSession)
    }

    const session = this.startSession("foreground", context)
    this.foregroundSession = session
    return toSessionInfo(session)
  }

  stopForeground(sessionId = this.foregroundSession?.sessionId): boolean {
    if (!sessionId) {
      return false
    }

    const session = this.sessions.get(sessionId)
    if (!session || session.kind !== "foreground") {
      return false
    }

    this.stopSession(session)
    return true
  }

  private async answerHostRequest(session: RuntimeSession, request: ExtensionHostRequest) {
    const response = await this.createHostResponse(session, request)
    if (this.sessions.get(session.sessionId) !== session) {
      return
    }

    session.process.postMessage({
      response,
      sessionId: session.sessionId,
      type: "host-response"
    })
  }

  private async createHostResponse(
    session: RuntimeSession,
    request: ExtensionHostRequest
  ): Promise<ExtensionHostResponse> {
    try {
      const result = await this.resolveHostRequest(session, request)
      return {
        id: request.id,
        ok: true,
        result
      }
    } catch (error) {
      return {
        error: toRuntimeError("host_request_failed", error),
        id: request.id,
        ok: false
      }
    }
  }

  private handleExit(session: RuntimeSession, code: number): void {
    this.detachSession(session)
    if (session.stopping) {
      return
    }

    const error: ExtensionRuntimeError = {
      code: "runtime_crashed",
      message: `Extension runtime exited with code ${code}.`
    }
    this.recordError(session, error)
  }

  private handleMessage(session: RuntimeSession, message: ExtensionRuntimeToHostMessage): void {
    if (
      message.sessionId !== session.sessionId ||
      this.sessions.get(session.sessionId) !== session
    ) {
      return
    }

    switch (message.type) {
      case "ready":
        if (session.kind === "run-once") {
          session.resolveRunOnce?.({
            sessionId: session.sessionId,
            status: "ready"
          })
          this.stopSession(session)
        }
        return
      case "surface":
        this.emitSurface(message.surface, toSessionInfo(session))
        return
      case "host-request":
        void this.answerHostRequest(session, message.request)
        return
      case "error":
        this.recordError(session, message.error)
        return
      case "metrics":
        this.options.onMetrics?.(message.metrics, toSessionInfo(session))
        return
    }
  }

  private recordError(session: RuntimeSession, error: ExtensionRuntimeError): void {
    const sessionError: ExtensionRuntimeSessionError = {
      error,
      sessionId: session.sessionId
    }
    this.lastError = sessionError
    session.resolveRunOnce?.({
      error,
      sessionId: session.sessionId,
      status: "error"
    })
    this.options.onError?.(sessionError)
    for (const listener of this.errorListeners) {
      listener(sessionError)
    }
    if (session.kind === "run-once" && this.sessions.get(session.sessionId) === session) {
      this.stopSession(session)
    }
  }

  private async resolveHostRequest(
    session: RuntimeSession,
    request: ExtensionHostRequest
  ): Promise<unknown> {
    switch (request.capability) {
      case "preferences":
        assertOwnExtension(session, request.payload.extensionName)
        if (request.method === "get-extension-preferences") {
          return this.options.host.getExtensionPreferences(request.payload.extensionName)
        }

        return this.options.host.getCommandPreferences({
          commandName: request.payload.commandName ?? session.context.commandName,
          extensionName: request.payload.extensionName
        })
      case "storage":
        if (request.method === "get") {
          return this.options.host.getStorageValue({
            context: session.context,
            key: request.payload.key
          })
        }

        await this.options.host.setStorageValue({
          context: session.context,
          key: request.payload.key,
          value: request.payload.value
        })
        return null
      case "shell":
        await this.options.host.openExternal(request.payload.url)
        return null
      case "settings":
        assertOwnExtension(session, request.payload.extensionName)
        await this.options.host.openExtensionSettings(request.payload)
        return null
      case "rpc":
        assertOwnExtension(session, request.payload.extensionName)
        return this.options.host.invokeNativeExtension(request.payload)
      case "ai":
      case "clipboard":
      case "navigation":
      case "scheduler":
        throw new Error(`Unsupported runtime host capability "${request.capability}"`)
    }
  }

  private startSession(
    kind: ExtensionRuntimeSessionKind,
    context: ExtensionRuntimeLaunchContext
  ): RuntimeSession {
    const sessionId = this.options.createSessionId?.() ?? randomUUID()
    const process = this.options.processLauncher.launch()
    const session: RuntimeSession = {
      context,
      disposeListeners: [],
      kind,
      process,
      sessionId,
      stopping: false
    }

    this.sessions.set(sessionId, session)
    session.disposeListeners.push(
      process.onMessage((message) => this.handleMessage(session, message)),
      process.onExit((code) => this.handleExit(session, code))
    )
    process.postMessage({
      context,
      sessionId,
      type: "start"
    })

    return session
  }

  private emitSurface(
    surface: ExtensionSurfaceSnapshot,
    sessionInfo: ExtensionRuntimeSessionInfo
  ): void {
    this.options.onSurface?.(surface, sessionInfo)
    for (const listener of this.surfaceListeners) {
      listener(surface, sessionInfo)
    }
  }

  private stopSession(session: RuntimeSession): void {
    session.stopping = true
    this.detachSession(session)
    session.process.postMessage({
      sessionId: session.sessionId,
      type: "stop"
    })
    session.process.kill()
  }

  private detachSession(session: RuntimeSession): void {
    for (const dispose of session.disposeListeners) {
      dispose()
    }
    session.disposeListeners = []
    this.sessions.delete(session.sessionId)
    if (this.foregroundSession === session) {
      this.foregroundSession = null
    }
  }
}

function assertOwnExtension(session: RuntimeSession, extensionName: string): void {
  if (extensionName !== session.context.extensionName) {
    throw new Error(
      `Runtime session "${session.sessionId}" cannot access extension "${extensionName}"`
    )
  }
}

function toRuntimeError(code: string, error: unknown): ExtensionRuntimeError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error)
  }
}

function toSessionInfo(session: RuntimeSession): ExtensionRuntimeSessionInfo {
  return {
    context: session.context,
    kind: session.kind,
    pid: session.process.pid,
    sessionId: session.sessionId
  }
}
