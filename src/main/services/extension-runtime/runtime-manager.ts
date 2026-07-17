import { createHash, randomUUID } from "crypto"
import type {
  ExtensionAiAskPayload,
  ExtensionAgentHostRequest,
  ExtensionConfirmAlertPayload,
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionNavigationHostRequest,
  ExtensionQuicklinksHostRequest,
  ExtensionRuntimeError,
  ExtensionRuntimeErrorDetails,
  ExtensionRuntimeEvent,
  ExtensionRuntimeEventAck,
  ExtensionRuntimeHostCapability,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeLaunchIntent,
  ExtensionRuntimeMetrics,
  ExtensionRuntimeRecoverableIssue,
  ExtensionRuntimeRunResult,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeSessionIssueSnapshot,
  ExtensionRuntimeSessionKind,
  ExtensionRuntimeStorageScope,
  ExtensionRuntimeToHostMessage,
  ExtensionSurfaceSnapshot,
  ExtensionToastPayload
} from "@shared/extension-runtime-protocol"
import {
  normalizeExtensionRuntimeErrorDetails,
  normalizeExtensionRuntimeNavigationHostRequest
} from "@shared/extension-runtime-protocol"
import type { NativeExtensionInvokeRequest } from "@shared/native-extensions"
import type { NativeExtensionExecutionContextSnapshot } from "../../native-extensions/execution-context"
import type {
  ExtensionRuntimeExecutionLease,
  ExtensionRuntimeExecutionLeaseOwner
} from "./execution-lease"
import type { ExtensionRuntimeProcess, ExtensionRuntimeProcessLauncher } from "./runtime-process"

export type {
  ExtensionRuntimeRunResult,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeSessionIssueSnapshot,
  ExtensionRuntimeSessionKind
} from "@shared/extension-runtime-protocol"

type MaybePromise<T> = T | Promise<T>

export interface ExtensionRuntimeStorageParams {
  context: ExtensionRuntimeLaunchContext
  key: string
  scope: ExtensionRuntimeStorageScope
}

export interface ExtensionRuntimeStorageScopeParams {
  context: ExtensionRuntimeLaunchContext
  scope: ExtensionRuntimeStorageScope
}

export interface ExtensionRuntimeHostCapabilities {
  askAI: (input: ExtensionAiAskPayload) => Promise<string>
  clearStorageValues: (params: ExtensionRuntimeStorageScopeParams) => MaybePromise<void>
  confirmAlert: (alert: ExtensionConfirmAlertPayload) => MaybePromise<boolean>
  getStorageValue: (params: ExtensionRuntimeStorageParams) => MaybePromise<unknown>
  handleNavigationRequest: (params: {
    request: ExtensionNavigationHostRequest
    sessionId: string
  }) => MaybePromise<void>
  handleRunBotAgentRequest: (params: {
    request: ExtensionAgentHostRequest
    sessionId: string
  }) => MaybePromise<unknown>
  invokeNativeExtension: (
    request: NativeExtensionInvokeRequest,
    context: NativeExtensionExecutionContextSnapshot
  ) => Promise<unknown>
  listStorageValues: (
    params: ExtensionRuntimeStorageScopeParams
  ) => MaybePromise<Record<string, unknown>>
  openExtensionSettings: (params: {
    commandName?: string
    extensionName: string
  }) => MaybePromise<void>
  openExternal: (params: ExtensionRuntimeOpenExternalParams) => Promise<void>
  pasteClipboardText: (content: { html?: string; text: string }) => MaybePromise<void>
  readClipboardText: () => MaybePromise<string>
  readSelectedText: () => MaybePromise<string>
  registerQuicklink: (params: ExtensionRuntimeRegisterQuicklinkParams) => MaybePromise<unknown>
  removeStorageValue: (params: ExtensionRuntimeStorageParams) => MaybePromise<void>
  setStorageValue: (
    params: ExtensionRuntimeStorageParams & { value: unknown }
  ) => MaybePromise<void>
  showToast: (params: { sessionId: string; toast: ExtensionToastPayload }) => MaybePromise<void>
  writeClipboardText: (content: { html?: string; text: string }) => MaybePromise<void>
}

export interface ExtensionRuntimeOpenExternalParams {
  allowedUrlSchemes: readonly string[]
  application?: {
    bundleId?: string
    name?: string
    path?: string
  }
  context: ExtensionRuntimeLaunchContext
  url: string
}

export interface ExtensionRuntimeRegisterQuicklinkParams {
  context: ExtensionRuntimeLaunchContext
  request: ExtensionQuicklinksHostRequest["payload"]
}

export type ExtensionRuntimeSurfaceListener = (
  surface: ExtensionSurfaceSnapshot,
  session: ExtensionRuntimeSessionInfo
) => void

export type ExtensionRuntimeErrorListener = (error: ExtensionRuntimeSessionError) => void
export type ExtensionRuntimeIssueSnapshotListener = (
  snapshot: ExtensionRuntimeSessionIssueSnapshot
) => void

export type ExtensionRuntimeEventAckListener = (
  ack: ExtensionRuntimeEventAck,
  session: ExtensionRuntimeSessionInfo
) => void

export type ExtensionRuntimeSessionStopReason = "configuration-revoked" | "other"

export type ExtensionRuntimeSessionStoppedListener = (
  session: ExtensionRuntimeSessionInfo,
  reason: ExtensionRuntimeSessionStopReason
) => void

export interface ExtensionRuntimeManagerOptions {
  createSessionId?: () => string
  executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner
  host: ExtensionRuntimeHostCapabilities
  onEventAck?: (ack: ExtensionRuntimeEventAck, session: ExtensionRuntimeSessionInfo) => void
  onError?: (error: ExtensionRuntimeSessionError) => void
  onIssueSnapshot?: (snapshot: ExtensionRuntimeSessionIssueSnapshot) => void
  onMetrics?: (metrics: ExtensionRuntimeMetrics, session: ExtensionRuntimeSessionInfo) => void
  onSurface?: (surface: ExtensionSurfaceSnapshot, session: ExtensionRuntimeSessionInfo) => void
  processLauncher: ExtensionRuntimeProcessLauncher
  subscribeConfigurationCommits?: (listener: () => void) => () => void
}

interface RuntimeStorageIssueAddress {
  id: string
  key: string
  scope: ExtensionRuntimeStorageScope
}

interface ActiveRuntimeStorageIssue extends RuntimeStorageIssueAddress {
  issue: ExtensionRuntimeRecoverableIssue
}

interface RuntimeSession {
  activeStorageIssues: Map<string, ActiveRuntimeStorageIssue>
  disposeListeners: Array<() => void>
  kind: ExtensionRuntimeSessionKind
  lease: ExtensionRuntimeExecutionLease
  process: ExtensionRuntimeProcess
  resolveRunOnce?: (result: ExtensionRuntimeRunResult) => void
  sessionId: string
  storageIssueTerminal: boolean
  storageIssueRevision: number
  stopping: boolean
}

interface StartSessionOptions {
  beforeStart?: (session: RuntimeSession) => void
  sessionId?: string
}

const CONFIGURATION_REVOKED_ERROR: ExtensionRuntimeError = Object.freeze({
  code: "runtime_configuration_revoked",
  message: "Extension runtime configuration changed. Reload the command to continue."
})
const MAX_RECOVERABLE_ISSUE_MESSAGE_LENGTH = 512
const MAX_TRACKED_RECOVERABLE_STORAGE_ISSUES = 64

export class ExtensionRuntimeManager {
  private disposed = false
  private foregroundSession: RuntimeSession | null = null
  private lastError: ExtensionRuntimeSessionError | null = null
  private readonly eventAckListeners = new Set<ExtensionRuntimeEventAckListener>()
  private readonly errorListeners = new Set<ExtensionRuntimeErrorListener>()
  private readonly issueSnapshotListeners = new Set<ExtensionRuntimeIssueSnapshotListener>()
  private issueRevision = 0
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly sessionStoppedListeners = new Set<ExtensionRuntimeSessionStoppedListener>()
  private readonly stopConfigurationSubscription: () => void
  private readonly surfaceListeners = new Set<ExtensionRuntimeSurfaceListener>()

  constructor(private readonly options: ExtensionRuntimeManagerOptions) {
    this.stopConfigurationSubscription =
      options.subscribeConfigurationCommits?.(() => {
        this.revokeInvalidConfigurationSessions()
      }) ?? (() => undefined)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    try {
      this.stopConfigurationSubscription()
    } catch (error) {
      console.error("[jingle:extension-runtime] Configuration observer cleanup failed", error)
    }
    const error: ExtensionRuntimeError = {
      code: "runtime_manager_disposed",
      message: "Extension runtime manager was disposed."
    }
    for (const session of Array.from(this.sessions.values())) {
      this.stopSession(session, error)
    }
  }

  getForegroundSession(): ExtensionRuntimeSessionInfo | null {
    const session = this.foregroundSession
    if (!session) {
      return null
    }
    if (!this.isLeaseCurrent(session.lease)) {
      this.revokeSession(session)
      return null
    }
    return toSessionInfo(session)
  }

  getLastError(): ExtensionRuntimeSessionError | null {
    return this.lastError
  }

  onEventAck(listener: ExtensionRuntimeEventAckListener): () => void {
    this.eventAckListeners.add(listener)
    return () => {
      this.eventAckListeners.delete(listener)
    }
  }

  onError(listener: ExtensionRuntimeErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  getIssueSnapshots(): ExtensionRuntimeSessionIssueSnapshot[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.storageIssueRevision > 0)
      .map(toStorageIssueSnapshot)
  }

  onIssueSnapshot(listener: ExtensionRuntimeIssueSnapshotListener): () => void {
    this.issueSnapshotListeners.add(listener)
    return () => {
      this.issueSnapshotListeners.delete(listener)
    }
  }

  onSurface(listener: ExtensionRuntimeSurfaceListener): () => void {
    this.surfaceListeners.add(listener)
    return () => {
      this.surfaceListeners.delete(listener)
    }
  }

  onSessionStopped(listener: ExtensionRuntimeSessionStoppedListener): () => void {
    this.sessionStoppedListeners.add(listener)
    return () => {
      this.sessionStoppedListeners.delete(listener)
    }
  }

  runOnce(
    intent: ExtensionRuntimeLaunchIntent,
    options?: {
      onSessionStart?: (session: ExtensionRuntimeSessionInfo) => void
      sessionId?: string
    }
  ): Promise<ExtensionRuntimeRunResult> {
    const sessionId = options?.sessionId ?? this.createSessionId()
    return new Promise((resolve) => {
      try {
        this.startSession("run-once", intent, {
          beforeStart: (session) => {
            session.resolveRunOnce = resolve
            options?.onSessionStart?.(toSessionInfo(session))
          },
          sessionId
        })
      } catch (error) {
        resolve({
          error: toRuntimeError(getRuntimeErrorCode(error, "runtime_start_failed"), error),
          sessionId,
          status: "error"
        })
      }
    })
  }

  sendEvent(sessionId: string, event: ExtensionRuntimeEvent): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.stopping) {
      return false
    }
    if (!this.isLeaseCurrent(session.lease)) {
      this.revokeSession(session)
      return false
    }

    try {
      session.process.postMessage({
        event,
        sessionId,
        type: "event"
      })
      return true
    } catch (error) {
      this.stopSessionWithError(session, toRuntimeError("runtime_transport_failed", error))
      return false
    }
  }

  async startAmbient(
    intent: ExtensionRuntimeLaunchIntent,
    options?: { onSessionStart?: (session: ExtensionRuntimeSessionInfo) => void }
  ): Promise<ExtensionRuntimeSessionInfo> {
    const session = this.startSession("ambient", intent, {
      beforeStart: options?.onSessionStart
        ? (startedSession) => options.onSessionStart?.(toSessionInfo(startedSession))
        : undefined
    })
    return toSessionInfo(session)
  }

  async startForeground(
    intent: ExtensionRuntimeLaunchIntent,
    options?: {
      onSessionStart?: (session: ExtensionRuntimeSessionInfo) => void
      sessionId?: string
    }
  ): Promise<ExtensionRuntimeSessionInfo> {
    const session = this.startSession("foreground", intent, {
      beforeStart: options?.onSessionStart
        ? (startedSession) => options.onSessionStart?.(toSessionInfo(startedSession))
        : undefined,
      sessionId: options?.sessionId
    })
    if (this.sessions.get(session.sessionId) !== session || !this.isLeaseCurrent(session.lease)) {
      if (this.sessions.get(session.sessionId) === session) {
        this.revokeSession(session)
      }
      throw new ExtensionRuntimeLifecycleError(
        CONFIGURATION_REVOKED_ERROR.code,
        CONFIGURATION_REVOKED_ERROR.message
      )
    }
    if (this.foregroundSession) {
      this.stopSessionWithError(this.foregroundSession, {
        code: "runtime_foreground_replaced",
        message: "Extension runtime foreground session was replaced."
      })
    }

    this.foregroundSession = session
    return toSessionInfo(session)
  }

  async discardStorageIssue(sessionId: string, issueId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    const issue = session?.activeStorageIssues.get(issueId)
    if (
      !session ||
      !issue ||
      issue.issue.recovery.strategy !== "discard-value" ||
      session.kind === "run-once"
    ) {
      return false
    }

    try {
      this.assertHostRequestAdmission(session, "storage")
      await this.options.host.removeStorageValue({
        context: session.lease.utility.context,
        key: issue.key,
        scope: issue.scope
      })
      if (this.sessions.get(sessionId) !== session || session.stopping) {
        return false
      }
      if (this.resolveIssue(session, issueId)) {
        this.emitIssueSnapshot(session)
      }
      return true
    } catch {
      this.stopSessionWithError(session, {
        code: "storage_issue_discard_failed",
        message: "The stored value could not be discarded."
      })
      return false
    }
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

  stopSessionById(sessionId: string, error?: ExtensionRuntimeError): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.stopping) {
      return false
    }

    if (error) {
      this.stopSessionWithError(session, error)
    } else {
      this.stopSession(session)
    }
    return true
  }

  revokeInvalidConfigurationSessions(): void {
    for (const session of Array.from(this.sessions.values())) {
      if (!this.isLeaseCurrent(session.lease)) {
        this.revokeSession(session)
      }
    }
  }

  private async answerHostRequest(session: RuntimeSession, request: ExtensionHostRequest) {
    const response = await this.createHostResponse(session, request)
    if (this.sessions.get(session.sessionId) !== session || session.stopping) {
      return
    }
    if (!this.isLeaseCurrent(session.lease)) {
      this.revokeSession(session)
      return
    }
    if (isRecoverableStorageResponse(response) && session.kind === "run-once") {
      this.stopSessionWithError(session, {
        code: "runtime_storage_recovery_unavailable",
        message: "Stored values need user recovery, but this runtime mode has no recovery surface."
      })
      return
    }

    try {
      session.process.postMessage({
        response,
        sessionId: session.sessionId,
        type: "host-response"
      })
      this.updateStorageIssue(session, request, response)
    } catch (error) {
      this.stopSessionWithError(session, toRuntimeError("runtime_transport_failed", error))
    }
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
      const runtimeError = toRuntimeError(getRuntimeErrorCode(error, "host_request_failed"), error)
      return {
        error: validateHostRequestError(request, runtimeError),
        id: request.id,
        ok: false
      }
    }
  }

  private handleExit(session: RuntimeSession, code: number): void {
    if (this.sessions.get(session.sessionId) !== session) {
      return
    }
    if (session.stopping) {
      this.emitSessionStopped(this.detachSession(session), "other")
      return
    }

    const error: ExtensionRuntimeError = {
      code: "runtime_crashed",
      message: `Extension runtime exited with code ${code}.`
    }
    session.stopping = true
    this.recordError(session, error)
    this.emitSessionStopped(this.detachSession(session), "other")
  }

  private handleMessage(session: RuntimeSession, message: ExtensionRuntimeToHostMessage): void {
    if (
      message.sessionId !== session.sessionId ||
      this.sessions.get(session.sessionId) !== session ||
      session.stopping
    ) {
      return
    }
    if (!this.isLeaseCurrent(session.lease)) {
      this.revokeSession(session)
      return
    }

    switch (message.type) {
      case "ready":
        if (session.kind === "run-once") {
          this.settleRunOnce(session, {
            sessionId: session.sessionId,
            status: "ready"
          })
          this.stopSession(session)
        }
        return
      case "surface":
        this.emitSurface(message.surface, toSessionInfo(session))
        return
      case "event-ack":
        this.emitEventAck(message.ack, toSessionInfo(session))
        return
      case "host-request":
        void this.answerHostRequest(session, message.request)
        return
      case "error":
        this.stopSessionWithError(session, message.error)
        return
      case "metrics":
        try {
          this.options.onMetrics?.(message.metrics, toSessionInfo(session))
        } catch (listenerError) {
          console.error(
            "[jingle:extension-runtime] Metrics projection listener failed",
            listenerError
          )
        }
        return
    }
  }

  private recordError(session: RuntimeSession, error: ExtensionRuntimeError): void {
    if (this.sessions.get(session.sessionId) !== session) {
      return
    }

    this.terminateIssueState(session)
    const sessionError: ExtensionRuntimeSessionError = {
      error,
      issueRevision: session.storageIssueRevision,
      sessionId: session.sessionId
    }
    this.lastError = sessionError
    this.settleRunOnce(session, {
      error,
      sessionId: session.sessionId,
      status: "error"
    })
    try {
      this.options.onError?.(sessionError)
    } catch (listenerError) {
      console.error("[jingle:extension-runtime] Error projection listener failed", listenerError)
    }
    for (const listener of this.errorListeners) {
      try {
        listener(sessionError)
      } catch (listenerError) {
        console.error("[jingle:extension-runtime] Error listener failed", listenerError)
      }
    }
  }

  private recordIssue(
    session: RuntimeSession,
    issue: ExtensionRuntimeRecoverableIssue,
    address: RuntimeStorageIssueAddress
  ): boolean {
    if (this.sessions.get(session.sessionId) !== session) {
      return false
    }

    if (
      !session.activeStorageIssues.has(address.id) &&
      session.activeStorageIssues.size >= MAX_TRACKED_RECOVERABLE_STORAGE_ISSUES
    ) {
      this.stopSessionWithError(session, {
        code: "runtime_storage_issue_limit_exceeded",
        message:
          "Too many legacy storage conflicts were reported safely. Reload the command after clearing its stored values."
      })
      return false
    }

    const current = session.activeStorageIssues.get(address.id)
    if (current?.issue.message === issue.message) {
      return false
    }
    session.activeStorageIssues.set(address.id, {
      ...address,
      issue
    })

    return true
  }

  private resolveIssue(session: RuntimeSession, issueId: string): boolean {
    return session.activeStorageIssues.delete(issueId)
  }

  private resolveStorageIssues(
    session: RuntimeSession,
    predicate: (issue: ActiveRuntimeStorageIssue) => boolean
  ): void {
    let changed = false
    for (const issue of Array.from(session.activeStorageIssues.values())) {
      if (predicate(issue)) {
        changed = this.resolveIssue(session, issue.id) || changed
      }
    }
    if (changed) {
      this.emitIssueSnapshot(session)
    }
  }

  private emitIssueSnapshot(session: RuntimeSession): void {
    session.storageIssueRevision = ++this.issueRevision
    const snapshot = toStorageIssueSnapshot(session)
    try {
      this.options.onIssueSnapshot?.(snapshot)
    } catch (listenerError) {
      console.error("[jingle:extension-runtime] Issue projection listener failed", listenerError)
    }
    for (const listener of this.issueSnapshotListeners) {
      try {
        listener(snapshot)
      } catch (listenerError) {
        console.error("[jingle:extension-runtime] Issue listener failed", listenerError)
      }
    }
  }

  private terminateIssueState(session: RuntimeSession): void {
    if (session.storageIssueTerminal) {
      return
    }
    session.activeStorageIssues.clear()
    session.storageIssueTerminal = true
    this.emitIssueSnapshot(session)
  }

  private updateStorageIssue(
    session: RuntimeSession,
    request: ExtensionHostRequest,
    response: ExtensionHostResponse
  ): void {
    if (request.capability !== "storage") {
      return
    }

    const scope = request.payload.scope ?? "command"
    if (!response.ok) {
      if (response.error.code !== "storage_legacy_unowned") {
        return
      }
      const details = tryNormalizeStorageLegacyUnownedDetails(response.error.details)
      if (!details || details.scope !== scope) {
        return
      }
      let changed = false
      for (const key of details.keys) {
        const issueId = createStorageIssueId(scope, key)
        changed =
          this.recordIssue(
            session,
            {
              code: "storage_legacy_unowned",
              id: issueId,
              message: createStorageIssueMessage(scope, key),
              recovery:
                scope === "command" && session.kind === "foreground"
                  ? { key, scope, strategy: "replace-value" }
                  : { key, scope, strategy: "discard-value" }
            },
            { id: issueId, key, scope }
          ) || changed
      }
      if (changed && this.sessions.get(session.sessionId) === session && !session.stopping) {
        this.emitIssueSnapshot(session)
      }
      return
    }

    if (request.method === "all-items" || request.method === "clear") {
      this.resolveStorageIssues(session, (issue) => issue.scope === scope)
      return
    }
    if (request.method === "get" || request.method === "set" || request.method === "remove") {
      this.resolveStorageIssues(
        session,
        (issue) => issue.scope === scope && issue.key === request.payload.key
      )
    }
  }

  private async resolveHostRequest(
    session: RuntimeSession,
    request: ExtensionHostRequest
  ): Promise<unknown> {
    this.assertHostRequestAdmission(session, request.capability)
    const context = session.lease.utility.context

    switch (request.capability) {
      case "storage": {
        switch (request.method) {
          case "get":
            return this.options.host.getStorageValue({
              context,
              key: request.payload.key,
              scope: request.payload.scope ?? "command"
            })
          case "remove":
            await this.options.host.removeStorageValue({
              context,
              key: request.payload.key,
              scope: request.payload.scope ?? "command"
            })
            return null
          case "all-items":
            return this.options.host.listStorageValues({
              context,
              scope: request.payload.scope ?? "command"
            })
          case "clear":
            await this.options.host.clearStorageValues({
              context,
              scope: request.payload.scope ?? "command"
            })
            return null
          case "set":
            await this.options.host.setStorageValue({
              context,
              key: request.payload.key,
              scope: request.payload.scope ?? "command",
              value: request.payload.value
            })
            return null
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "shell": {
        switch (request.method) {
          case "open-external":
            await this.options.host.openExternal({
              allowedUrlSchemes: request.payload.allowedUrlSchemes ?? [],
              application: request.payload.application,
              context,
              url: request.payload.url
            })
            return null
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "settings": {
        switch (request.method) {
          case "open-extension":
            assertOwnExtension(session, request.payload.extensionName)
            await this.options.host.openExtensionSettings(request.payload)
            return null
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "quicklinks": {
        switch (request.method) {
          case "register":
            if (request.payload.extensionName !== undefined) {
              assertOwnExtension(session, request.payload.extensionName)
            }
            return this.options.host.registerQuicklink({
              context,
              request: {
                ...request.payload,
                extensionName: session.lease.intent.extensionName
              }
            })
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "rpc": {
        switch (request.method) {
          case "invoke-native-extension":
            assertOwnExtension(session, request.payload.extensionName)
            return this.options.host.invokeNativeExtension(
              request.payload,
              session.lease.invokeContext
            )
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "navigation": {
        switch (request.method) {
          case "go-home":
          case "hide-launcher":
          case "open-command":
            return this.options.host.handleNavigationRequest({
              request: normalizeExtensionRuntimeNavigationHostRequest(request),
              sessionId: session.sessionId
            })
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "clipboard": {
        switch (request.method) {
          case "read-text":
            return this.options.host.readClipboardText()
          case "read-selected-text":
            return this.options.host.readSelectedText()
          case "paste-text":
            await this.options.host.pasteClipboardText(request.payload)
            return null
          case "write-text":
            await this.options.host.writeClipboardText(request.payload)
            return null
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "dialog": {
        switch (request.method) {
          case "confirm-alert":
            return this.options.host.confirmAlert(request.payload)
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "toast": {
        switch (request.method) {
          case "show":
            await this.options.host.showToast({
              sessionId: session.sessionId,
              toast: request.payload
            })
            return null
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "ai": {
        switch (request.method) {
          case "ask":
            return this.options.host.askAI(request.payload)
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "agent": {
        switch (request.method) {
          case "run-bot-agent":
            return this.options.host.handleRunBotAgentRequest({
              request,
              sessionId: session.sessionId
            })
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      case "scheduler": {
        switch (request.method) {
          case "set-background-refresh":
            return throwUnsupportedWireHostRequest(request)
          default:
            return throwUnsupportedHostRequest(request)
        }
      }
      default:
        return throwUnsupportedHostRequest(request)
    }
  }

  private startSession(
    kind: ExtensionRuntimeSessionKind,
    intent: ExtensionRuntimeLaunchIntent,
    options: StartSessionOptions = {}
  ): RuntimeSession {
    if (this.disposed) {
      throw new ExtensionRuntimeLifecycleError(
        "runtime_manager_disposed",
        "Extension runtime is disposed."
      )
    }

    const sessionId = options.sessionId ?? this.createSessionId()
    if (this.sessions.has(sessionId)) {
      throw new ExtensionRuntimeLifecycleError(
        "runtime_session_conflict",
        `Extension runtime session "${sessionId}" already exists.`
      )
    }

    const lease = this.options.executionLeaseOwner.resolve(kind, intent)
    if (this.disposed) {
      throw new ExtensionRuntimeLifecycleError(
        "runtime_manager_disposed",
        "Extension runtime is disposed."
      )
    }
    if (!this.isLeaseCurrent(lease)) {
      throw new ExtensionRuntimeLifecycleError(
        CONFIGURATION_REVOKED_ERROR.code,
        CONFIGURATION_REVOKED_ERROR.message
      )
    }
    if (this.sessions.has(sessionId)) {
      throw new ExtensionRuntimeLifecycleError(
        "runtime_session_conflict",
        `Extension runtime session "${sessionId}" already exists.`
      )
    }

    const process = this.options.processLauncher.launch()
    const session: RuntimeSession = {
      activeStorageIssues: new Map(),
      disposeListeners: [],
      kind,
      lease,
      process,
      sessionId,
      storageIssueTerminal: false,
      storageIssueRevision: 0,
      stopping: false
    }

    let configurationRevoked = false
    try {
      this.sessions.set(sessionId, session)
      session.disposeListeners.push(
        process.onMessage((message) => this.handleMessage(session, message))
      )
      session.disposeListeners.push(process.onExit((code) => this.handleExit(session, code)))
      options.beforeStart?.(session)
      if (!this.isLeaseCurrent(lease)) {
        configurationRevoked = true
        throw new ExtensionRuntimeLifecycleError(
          CONFIGURATION_REVOKED_ERROR.code,
          CONFIGURATION_REVOKED_ERROR.message
        )
      }
      process.postMessage({
        lease: lease.utility,
        sessionId,
        type: "start"
      })
      return session
    } catch (error) {
      const runtimeError = toRuntimeError(getRuntimeErrorCode(error, "runtime_start_failed"), error)
      this.stopSessionWithError(
        session,
        runtimeError,
        configurationRevoked ? "configuration-revoked" : "other"
      )
      throw error
    }
  }

  private assertHostRequestAdmission(
    session: RuntimeSession,
    capability: ExtensionRuntimeHostCapability
  ): void {
    if (
      session.stopping ||
      this.sessions.get(session.sessionId) !== session ||
      !this.isLeaseCurrent(session.lease)
    ) {
      if (this.sessions.get(session.sessionId) === session && !session.stopping) {
        this.revokeSession(session)
      }
      throw new ExtensionRuntimeLifecycleError(
        CONFIGURATION_REVOKED_ERROR.code,
        CONFIGURATION_REVOKED_ERROR.message
      )
    }
    assertRuntimeCapability(session, capability)
  }

  private createSessionId(): string {
    return this.options.createSessionId?.() ?? randomUUID()
  }

  private emitSurface(
    surface: ExtensionSurfaceSnapshot,
    sessionInfo: ExtensionRuntimeSessionInfo
  ): void {
    try {
      this.options.onSurface?.(surface, sessionInfo)
    } catch (listenerError) {
      console.error("[jingle:extension-runtime] Surface projection listener failed", listenerError)
    }
    for (const listener of this.surfaceListeners) {
      try {
        listener(surface, sessionInfo)
      } catch (listenerError) {
        console.error("[jingle:extension-runtime] Surface listener failed", listenerError)
      }
    }
  }

  private emitEventAck(
    ack: ExtensionRuntimeEventAck,
    sessionInfo: ExtensionRuntimeSessionInfo
  ): void {
    try {
      this.options.onEventAck?.(ack, sessionInfo)
    } catch (listenerError) {
      console.error(
        "[jingle:extension-runtime] Event ack projection listener failed",
        listenerError
      )
    }
    for (const listener of this.eventAckListeners) {
      try {
        listener(ack, sessionInfo)
      } catch (listenerError) {
        console.error("[jingle:extension-runtime] Event ack listener failed", listenerError)
      }
    }
  }

  private isLeaseCurrent(lease: ExtensionRuntimeExecutionLease): boolean {
    try {
      return this.options.executionLeaseOwner.isCurrent(lease)
    } catch {
      return false
    }
  }

  private revokeSession(session: RuntimeSession): void {
    if (this.sessions.get(session.sessionId) !== session || session.stopping) {
      return
    }

    this.stopSessionWithError(session, CONFIGURATION_REVOKED_ERROR, "configuration-revoked")
  }

  private stopSessionWithError(
    session: RuntimeSession,
    error: ExtensionRuntimeError,
    reason: ExtensionRuntimeSessionStopReason = "other"
  ): void {
    if (this.sessions.get(session.sessionId) !== session || session.stopping) {
      return
    }
    session.stopping = true
    this.recordError(session, error)
    this.finishStopSession(session, error, reason)
  }

  private settleRunOnce(session: RuntimeSession, result: ExtensionRuntimeRunResult): boolean {
    const resolve = session.resolveRunOnce
    if (!resolve) {
      return false
    }

    session.resolveRunOnce = undefined
    resolve(result)
    return true
  }

  private stopSession(
    session: RuntimeSession,
    runOnceError?: ExtensionRuntimeError,
    reason: ExtensionRuntimeSessionStopReason = "other"
  ): void {
    if (this.sessions.get(session.sessionId) !== session || session.stopping) {
      return
    }

    session.stopping = true
    this.terminateIssueState(session)
    this.finishStopSession(session, runOnceError, reason)
  }

  private finishStopSession(
    session: RuntimeSession,
    runOnceError: ExtensionRuntimeError | undefined,
    reason: ExtensionRuntimeSessionStopReason
  ): void {
    if (runOnceError) {
      this.settleRunOnce(session, {
        error: runOnceError,
        sessionId: session.sessionId,
        status: "error"
      })
    }
    const sessionInfo = this.detachSession(session)
    try {
      session.process.postMessage({
        sessionId: session.sessionId,
        type: "stop"
      })
    } catch (error) {
      console.error("[jingle:extension-runtime] Failed to request runtime stop", error)
    }
    try {
      session.process.kill()
    } catch (error) {
      console.error("[jingle:extension-runtime] Failed to kill runtime process", error)
    }
    this.emitSessionStopped(sessionInfo, reason)
  }

  private detachSession(session: RuntimeSession): ExtensionRuntimeSessionInfo | null {
    const wasRegistered = this.sessions.get(session.sessionId) === session
    const sessionInfo = wasRegistered ? toSessionInfo(session) : null
    for (const dispose of session.disposeListeners) {
      try {
        dispose()
      } catch (error) {
        console.error("[jingle:extension-runtime] Runtime listener cleanup failed", error)
      }
    }
    session.disposeListeners = []
    if (wasRegistered) {
      this.sessions.delete(session.sessionId)
    }
    if (this.foregroundSession === session) {
      this.foregroundSession = null
    }
    return sessionInfo
  }

  private emitSessionStopped(
    sessionInfo: ExtensionRuntimeSessionInfo | null,
    reason: ExtensionRuntimeSessionStopReason
  ): void {
    if (!sessionInfo) {
      return
    }
    for (const listener of this.sessionStoppedListeners) {
      try {
        listener(sessionInfo, reason)
      } catch (listenerError) {
        console.error("[jingle:extension-runtime] Session stopped listener failed", listenerError)
      }
    }
  }
}

function throwUnsupportedHostRequest(request: never): never {
  return throwUnsupportedWireHostRequest(request)
}

function throwUnsupportedWireHostRequest(request: unknown): never {
  const unsupported = request as {
    capability?: unknown
    method?: unknown
  }
  throw new ExtensionRuntimeLifecycleError(
    "host_request_unsupported",
    `Unsupported runtime host request "${String(unsupported.capability)}:${String(unsupported.method)}".`
  )
}

function assertOwnExtension(session: RuntimeSession, extensionName: string): void {
  if (extensionName !== session.lease.intent.extensionName) {
    throw new Error(
      `Runtime session "${session.sessionId}" cannot access extension "${extensionName}"`
    )
  }
}

function assertRuntimeCapability(
  session: RuntimeSession,
  capability: ExtensionRuntimeHostCapability
): void {
  if (!session.lease.runtimeCapabilities.includes(capability)) {
    throw new Error(
      `Runtime command "${session.lease.intent.extensionName}:${session.lease.intent.commandName}" tried to use undeclared host capability "${capability}"`
    )
  }
}

function getRuntimeErrorCode(error: unknown, fallback: string): string {
  return error instanceof ExtensionRuntimeLifecycleError ||
    error instanceof ExtensionRuntimeHostError
    ? error.code
    : fallback
}

function toRuntimeError(code: string, error: unknown): ExtensionRuntimeError {
  const message = error instanceof Error ? error.message : String(error)
  if (code === "storage_legacy_unowned") {
    const details =
      error instanceof ExtensionRuntimeHostError
        ? tryNormalizeStorageLegacyUnownedDetails(error.details)
        : null
    if (!details) {
      return {
        code: "host_request_failed",
        message: "The storage host returned an invalid legacy conflict response."
      }
    }
    return {
      code,
      details,
      message: message.slice(0, MAX_RECOVERABLE_ISSUE_MESSAGE_LENGTH)
    }
  }
  return {
    code,
    message
  }
}

function validateHostRequestError(
  request: ExtensionHostRequest,
  error: ExtensionRuntimeError
): ExtensionRuntimeError {
  if (request.capability === "storage" && error.code !== "storage_legacy_unowned") {
    if (error.code === "runtime_response_invalid") {
      return error
    }
    if (error.code === "host_request_unsupported") {
      return {
        code: error.code,
        message: "Unsupported extension storage request."
      }
    }
    return {
      code: "host_request_failed",
      message: "Extension storage request failed."
    }
  }
  if (error.code !== "storage_legacy_unowned") {
    return error
  }
  if (request.capability !== "storage") {
    return invalidStorageRecoveryResponse()
  }
  const details = tryNormalizeStorageLegacyUnownedDetails(error.details)
  const scope = request.payload.scope ?? "command"
  if (!details || details.scope !== scope) {
    return invalidStorageRecoveryResponse()
  }
  const matchesRequest =
    request.method === "all-items" ||
    (request.method === "get" &&
      details.keys.length === 1 &&
      details.keys[0] === request.payload.key)
  if (!matchesRequest) {
    return invalidStorageRecoveryResponse()
  }
  return {
    ...error,
    details
  }
}

function invalidStorageRecoveryResponse(): ExtensionRuntimeError {
  return {
    code: "runtime_response_invalid",
    message: "The storage host returned recovery details that do not match the request."
  }
}

function isRecoverableStorageResponse(response: ExtensionHostResponse): boolean {
  return !response.ok && response.error.code === "storage_legacy_unowned"
}

function tryNormalizeStorageLegacyUnownedDetails(
  details: unknown
): Extract<ExtensionRuntimeErrorDetails, { kind: "storage-legacy-unowned" }> | null {
  try {
    return normalizeExtensionRuntimeErrorDetails(details)
  } catch {
    return null
  }
}

function createStorageIssueMessage(scope: ExtensionRuntimeStorageScope, key: string): string {
  const quotedKey = JSON.stringify(key)
  const message =
    scope === "command"
      ? `Legacy command storage key ${quotedKey} has no current owner. Update the form, list, or storage hook value that owns this key to recover.`
      : `Legacy stored value ${quotedKey} has no current owner. Discard it with the recovery action below to continue.`
  return message.slice(0, MAX_RECOVERABLE_ISSUE_MESSAGE_LENGTH)
}

function createStorageIssueId(scope: ExtensionRuntimeStorageScope, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([scope, key]))
    .digest("hex")
  return `storage-legacy-unowned:${digest}`
}

function toStorageIssueSnapshot(session: RuntimeSession): ExtensionRuntimeSessionIssueSnapshot {
  return Object.freeze({
    issues: Object.freeze(
      Array.from(session.activeStorageIssues.values(), ({ issue }) =>
        Object.freeze({
          ...issue,
          recovery: Object.freeze({ ...issue.recovery })
        })
      )
    ),
    revision: session.storageIssueRevision,
    sessionId: session.sessionId,
    terminal: session.storageIssueTerminal
  })
}

function toSessionInfo(session: RuntimeSession): ExtensionRuntimeSessionInfo {
  return {
    intent: session.lease.intent,
    kind: session.kind,
    sessionId: session.sessionId
  }
}

export class ExtensionRuntimeLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "ExtensionRuntimeLifecycleError"
  }
}

export class ExtensionRuntimeHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: ExtensionRuntimeErrorDetails
  ) {
    super(message)
    this.name = "ExtensionRuntimeHostError"
  }
}
