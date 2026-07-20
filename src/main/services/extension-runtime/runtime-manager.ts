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
  ExtensionRuntimeCacheWriterLease,
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
import { ExtensionRuntimeExecutionLeaseError } from "./execution-lease"
import type { ExtensionRuntimeCacheLeaseCoordinator } from "./cache-lease-coordinator"
import { ExtensionRuntimeCacheLeaseCoordinatorError } from "./cache-lease-coordinator"
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
  cacheLeaseCoordinator: ExtensionRuntimeCacheLeaseCoordinator
  createSessionId?: () => string
  executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner
  host: ExtensionRuntimeHostCapabilities
  onEventAck?: (ack: ExtensionRuntimeEventAck, session: ExtensionRuntimeSessionInfo) => void
  onError?: (error: ExtensionRuntimeSessionError) => void
  onIssueSnapshot?: (snapshot: ExtensionRuntimeSessionIssueSnapshot) => void
  onMetrics?: (metrics: ExtensionRuntimeMetrics, session: ExtensionRuntimeSessionInfo) => void
  onSurface?: (surface: ExtensionSurfaceSnapshot, session: ExtensionRuntimeSessionInfo) => void
  processLauncher: ExtensionRuntimeProcessLauncher
  scheduleStopTimeout?: (listener: () => void) => () => void
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

interface RuntimeSessionStopState {
  awaitingExit: boolean
  cancelTimeout: () => void
  error?: ExtensionRuntimeError
  reason: ExtensionRuntimeSessionStopReason
}

interface RuntimeSession {
  activeStorageIssues: Map<string, ActiveRuntimeStorageIssue>
  cacheRetentionReleased: boolean
  cacheWriterLease: ExtensionRuntimeCacheWriterLease
  cacheWriterLeaseRevoked: boolean
  disposeCacheRetentionExitListener: (() => void) | null
  disposeListeners: Array<() => void>
  kind: ExtensionRuntimeSessionKind
  lease: ExtensionRuntimeExecutionLease
  pendingRunOnceSuccess: boolean
  process: ExtensionRuntimeProcess
  resolveCacheRetentionExitBarrier: (() => void) | null
  resolveRunOnce?: (result: ExtensionRuntimeRunResult) => void
  sessionId: string
  storageIssueTerminal: boolean
  storageIssueRevision: number
  stopState: RuntimeSessionStopState | null
  stopWaiters: Set<() => void>
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
const CACHE_PERSISTENCE_ERROR: ExtensionRuntimeError = Object.freeze({
  code: "runtime_cache_persistence_failed",
  message: "Extension runtime cache persistence failed."
})
const RUNTIME_STOP_ACK_MISSING_ERROR: ExtensionRuntimeError = Object.freeze({
  code: "runtime_stop_ack_missing",
  message: "Extension runtime exited before confirming its cache was flushed."
})
const RUNTIME_STOP_TIMEOUT_ERROR: ExtensionRuntimeError = Object.freeze({
  code: "runtime_stop_timeout",
  message: "Extension runtime did not confirm graceful shutdown in time."
})
const CACHE_WRITER_LEASE_CLEANUP_ERROR: ExtensionRuntimeError = Object.freeze({
  code: "runtime_cache_writer_lease_failed",
  message: "Extension runtime cache writer lease coordination failed."
})
const DEFAULT_RUNTIME_STOP_TIMEOUT_MS = 60_000
const MAX_RECOVERABLE_ISSUE_MESSAGE_LENGTH = 512
const MAX_TRACKED_RECOVERABLE_STORAGE_ISSUES = 64

export class ExtensionRuntimeManager {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private foregroundSession: RuntimeSession | null = null
  private lastError: ExtensionRuntimeSessionError | null = null
  private readonly pendingCacheRetentionExitBarriers = new Set<Promise<void>>()
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

  dispose(): Promise<void> {
    if (this.disposed) {
      return this.disposePromise ?? Promise.resolve()
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
    const sessions = Array.from(this.sessions.values())
    const stopPromises = sessions.map((session) => this.waitForSessionStop(session))
    this.disposePromise = Promise.all(stopPromises)
      .then(() => this.waitForCacheRetentionExitBarriers())
      .then(() => this.options.cacheLeaseCoordinator.dispose())
    for (const session of sessions) {
      this.stopSession(session, error)
    }
    return this.disposePromise
  }

  getForegroundSession(): ExtensionRuntimeSessionInfo | null {
    const session = this.foregroundSession
    if (!session || session.stopping) {
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
      void this.startSession("run-once", intent, {
        beforeStart: (session) => {
          session.resolveRunOnce = resolve
          options?.onSessionStart?.(toSessionInfo(session))
        },
        sessionId
      }).catch((error: unknown) => {
        resolve({
          error: toRuntimeError(getRuntimeErrorCode(error, "runtime_start_failed"), error),
          sessionId,
          status: "error"
        })
      })
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
    const session = await this.startSession("ambient", intent, {
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
    const sessionId = options?.sessionId ?? this.createSessionId()
    if (this.sessions.has(sessionId)) {
      throw new ExtensionRuntimeLifecycleError(
        "runtime_session_conflict",
        `Extension runtime session "${sessionId}" already exists.`
      )
    }
    const replacedSession = this.foregroundSession
    if (replacedSession && this.sessions.get(replacedSession.sessionId) === replacedSession) {
      this.revokeForegroundWriterBeforeReplacement(replacedSession)
    }
    const session = await this.startSession("foreground", intent, {
      beforeStart: options?.onSessionStart
        ? (startedSession) => options.onSessionStart?.(toSessionInfo(startedSession))
        : undefined,
      sessionId
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
      if (!session.stopState?.error) {
        session.stopState!.error = RUNTIME_STOP_ACK_MISSING_ERROR
        this.recordError(session, RUNTIME_STOP_ACK_MISSING_ERROR)
      }
      this.finalizeStopSession(session, { processExited: true })
      return
    }

    const error: ExtensionRuntimeError = {
      code: "runtime_crashed",
      message: `Extension runtime exited with code ${code}.`
    }
    session.stopping = true
    session.stopState = {
      awaitingExit: true,
      cancelTimeout: () => undefined,
      error,
      reason: "other"
    }
    this.recordError(session, error)
    this.finalizeStopSession(session, { processExited: true })
  }

  private handleMessage(session: RuntimeSession, message: ExtensionRuntimeToHostMessage): void {
    if (
      message.sessionId !== session.sessionId ||
      this.sessions.get(session.sessionId) !== session
    ) {
      return
    }
    if (message.type === "stopped") {
      this.handleStopped(session, message.result)
      return
    }
    if (message.type === "cache-persistence-failed") {
      this.handleCachePersistenceFailure(session)
      return
    }
    if (session.stopping) {
      return
    }
    if (!this.isLeaseCurrent(session.lease)) {
      this.revokeSession(session)
      return
    }

    switch (message.type) {
      case "ready":
        if (session.kind === "run-once") {
          session.pendingRunOnceSuccess = true
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

  private handleCachePersistenceFailure(session: RuntimeSession): void {
    if (!session.stopping || !session.stopState) {
      this.stopSessionWithError(session, CACHE_PERSISTENCE_ERROR)
      return
    }
    if (!session.stopState.error) {
      session.stopState.error = CACHE_PERSISTENCE_ERROR
      this.recordError(session, CACHE_PERSISTENCE_ERROR)
    }
  }

  private handleStopped(session: RuntimeSession, result: unknown): void {
    if (!session.stopping || !session.stopState) {
      this.stopSessionWithError(session, {
        code: "runtime_stop_response_invalid",
        message: "Extension runtime confirmed a stop that was not requested."
      })
      this.escalateStopToProcessExit(session, session.stopState!)
      return
    }

    if (session.stopState.awaitingExit) {
      return
    }

    const resultKind = getRuntimeStopResultKind(result)
    if (resultKind === "cache-persistence-failed") {
      if (!session.stopState.error) {
        session.stopState.error = CACHE_PERSISTENCE_ERROR
        this.recordError(session, CACHE_PERSISTENCE_ERROR)
      }
    } else if (resultKind !== "flushed") {
      if (!session.stopState.error) {
        session.stopState.error = {
          code: "runtime_stop_response_invalid",
          message: "Extension runtime returned an invalid graceful stop result."
        }
        this.recordError(session, session.stopState.error)
      }
      this.escalateStopToProcessExit(session, session.stopState)
      return
    } else if (session.pendingRunOnceSuccess && !session.stopState.error) {
      this.settleRunOnce(session, {
        sessionId: session.sessionId,
        status: "ready"
      })
    }
    this.finalizeStopSession(session)
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

  private async startSession(
    kind: ExtensionRuntimeSessionKind,
    intent: ExtensionRuntimeLaunchIntent,
    options: StartSessionOptions = {}
  ): Promise<RuntimeSession> {
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

    const cacheWriterLease = this.options.cacheLeaseCoordinator.activate(sessionId)
    let process: ExtensionRuntimeProcess
    try {
      process = this.options.processLauncher.launch({ cacheWriterLease })
    } catch (launchError) {
      let revokeError: unknown
      try {
        this.options.cacheLeaseCoordinator.revokeWrites(cacheWriterLease)
      } catch (cause) {
        revokeError = cause
      }
      try {
        await this.options.cacheLeaseCoordinator.releaseRetention(cacheWriterLease)
      } catch (releaseError) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(
          new AggregateError(
            [launchError, ...(revokeError === undefined ? [] : [revokeError]), releaseError],
            "Extension runtime launch cleanup failed."
          )
        )
      }
      throw launchError
    }
    const session: RuntimeSession = {
      activeStorageIssues: new Map(),
      cacheRetentionReleased: false,
      cacheWriterLease,
      cacheWriterLeaseRevoked: false,
      disposeCacheRetentionExitListener: null,
      disposeListeners: [],
      kind,
      lease,
      pendingRunOnceSuccess: false,
      process,
      resolveCacheRetentionExitBarrier: null,
      sessionId,
      storageIssueTerminal: false,
      storageIssueRevision: 0,
      stopState: null,
      stopWaiters: new Set(),
      stopping: false
    }

    let configurationRevoked = false
    try {
      this.sessions.set(sessionId, session)
      this.trackCacheRetentionProcessExit(session)
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

  private revokeForegroundWriterBeforeReplacement(session: RuntimeSession): void {
    if (!this.revokeCacheWriterLease(session)) {
      if (!session.stopping) {
        session.stopping = true
        session.stopState = {
          awaitingExit: false,
          cancelTimeout: () => undefined,
          error: CACHE_WRITER_LEASE_CLEANUP_ERROR,
          reason: "other"
        }
        this.recordError(session, CACHE_WRITER_LEASE_CLEANUP_ERROR)
      }
      if (session.stopState) {
        this.escalateStopToProcessExit(session, session.stopState)
      }
      throw new ExtensionRuntimeLifecycleError(
        CACHE_WRITER_LEASE_CLEANUP_ERROR.code,
        CACHE_WRITER_LEASE_CLEANUP_ERROR.message
      )
    }

    if (!session.stopping) {
      this.stopSessionWithError(session, {
        code: "runtime_foreground_replaced",
        message: "Extension runtime foreground session was replaced."
      })
    }
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
    session.stopState = {
      awaitingExit: false,
      cancelTimeout: () => undefined,
      error,
      reason
    }
    this.recordError(session, error)
    this.requestStop(session)
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
    session.stopState = {
      awaitingExit: false,
      cancelTimeout: () => undefined,
      ...(runOnceError ? { error: runOnceError } : {}),
      reason
    }
    this.terminateIssueState(session)
    if (runOnceError) {
      this.settleRunOnce(session, {
        error: runOnceError,
        sessionId: session.sessionId,
        status: "error"
      })
    }
    this.requestStop(session)
  }

  private requestStop(session: RuntimeSession): void {
    const stopState = session.stopState
    if (!stopState || this.sessions.get(session.sessionId) !== session) {
      return
    }

    stopState.cancelTimeout = this.scheduleStopTimeout(() => {
      if (this.sessions.get(session.sessionId) !== session || session.stopState !== stopState) {
        return
      }
      if (!stopState.error) {
        stopState.error = RUNTIME_STOP_TIMEOUT_ERROR
        this.recordError(session, RUNTIME_STOP_TIMEOUT_ERROR)
      }
      this.escalateStopToProcessExit(session, stopState)
    })
    if (this.sessions.get(session.sessionId) !== session || session.stopState !== stopState) {
      return
    }
    try {
      session.process.postMessage({
        sessionId: session.sessionId,
        type: "stop"
      })
    } catch (error) {
      if (!stopState.error) {
        stopState.error = toRuntimeError("runtime_transport_failed", error)
        this.recordError(session, stopState.error)
      }
      this.escalateStopToProcessExit(session, stopState)
    }
  }

  private scheduleStopTimeout(listener: () => void): () => void {
    if (this.options.scheduleStopTimeout) {
      return this.options.scheduleStopTimeout(listener)
    }
    const timeout = setTimeout(listener, DEFAULT_RUNTIME_STOP_TIMEOUT_MS)
    return () => {
      clearTimeout(timeout)
    }
  }

  private escalateStopToProcessExit(
    session: RuntimeSession,
    stopState: RuntimeSessionStopState
  ): void {
    if (
      this.sessions.get(session.sessionId) !== session ||
      session.stopState !== stopState ||
      stopState.awaitingExit
    ) {
      return
    }
    stopState.awaitingExit = true
    this.cancelStopTimeout(stopState)
    this.revokeCacheWriterLease(session)
    try {
      session.process.kill()
    } catch (error) {
      console.error("[jingle:extension-runtime] Failed to kill runtime process", error)
    }
  }

  private finalizeStopSession(
    session: RuntimeSession,
    options: { processExited?: boolean } = {}
  ): void {
    const stopState = session.stopState
    if (!stopState || this.sessions.get(session.sessionId) !== session) {
      return
    }

    const leaseRevoked = this.revokeCacheWriterLease(session)
    if (!leaseRevoked && !options.processExited) {
      this.escalateStopToProcessExit(session, stopState)
      return
    }
    session.stopState = null
    this.cancelStopTimeout(stopState)
    const sessionInfo = this.detachSession(session)
    if (!options.processExited) {
      try {
        session.process.kill()
      } catch (error) {
        console.error("[jingle:extension-runtime] Failed to kill runtime process", error)
      }
    }
    this.emitSessionStopped(sessionInfo, stopState.reason)
  }

  private revokeCacheWriterLease(session: RuntimeSession): boolean {
    if (session.cacheWriterLeaseRevoked) {
      return true
    }
    try {
      this.options.cacheLeaseCoordinator.revokeWrites(session.cacheWriterLease)
      session.cacheWriterLeaseRevoked = true
      return true
    } catch {
      console.error("[jingle:extension-runtime] Cache writer revocation failed.")
      if (session.stopState && !session.stopState.error) {
        session.stopState.error = CACHE_WRITER_LEASE_CLEANUP_ERROR
        this.recordError(session, CACHE_WRITER_LEASE_CLEANUP_ERROR)
      }
      return false
    }
  }

  private releaseCacheRetentionAfterProcessExit(session: RuntimeSession): void {
    if (session.cacheRetentionReleased) {
      return
    }
    session.disposeCacheRetentionExitListener?.()
    session.disposeCacheRetentionExitListener = null
    session.cacheRetentionReleased = true
    void this.options.cacheLeaseCoordinator
      .releaseRetention(session.cacheWriterLease)
      .catch(() => {
        session.cacheRetentionReleased = false
        console.error("[jingle:extension-runtime] Cache retention release failed.")
      })
      .finally(() => {
        session.resolveCacheRetentionExitBarrier?.()
        session.resolveCacheRetentionExitBarrier = null
      })
  }

  private trackCacheRetentionProcessExit(session: RuntimeSession): void {
    let resolveBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      resolveBarrier = resolve
    })
    session.resolveCacheRetentionExitBarrier = resolveBarrier
    this.pendingCacheRetentionExitBarriers.add(barrier)
    void barrier.finally(() => {
      this.pendingCacheRetentionExitBarriers.delete(barrier)
    })
    try {
      session.disposeCacheRetentionExitListener = session.process.onExit(() => {
        this.releaseCacheRetentionAfterProcessExit(session)
      })
    } catch (error) {
      session.resolveCacheRetentionExitBarrier = null
      resolveBarrier()
      throw error
    }
  }

  private async waitForCacheRetentionExitBarriers(): Promise<void> {
    while (this.pendingCacheRetentionExitBarriers.size > 0) {
      await Promise.all(Array.from(this.pendingCacheRetentionExitBarriers))
    }
  }

  private cancelStopTimeout(stopState: RuntimeSessionStopState): void {
    const cancel = stopState.cancelTimeout
    stopState.cancelTimeout = () => undefined
    cancel()
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
    for (const resolve of session.stopWaiters) {
      resolve()
    }
    session.stopWaiters.clear()
    return sessionInfo
  }

  private waitForSessionStop(session: RuntimeSession): Promise<void> {
    if (this.sessions.get(session.sessionId) !== session) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      session.stopWaiters.add(resolve)
    })
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
    error instanceof ExtensionRuntimeHostError ||
    error instanceof ExtensionRuntimeExecutionLeaseError ||
    error instanceof ExtensionRuntimeCacheLeaseCoordinatorError
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

function getRuntimeStopResultKind(result: unknown): "cache-persistence-failed" | "flushed" | null {
  if (!result || typeof result !== "object" || !("kind" in result)) {
    return null
  }
  const kind = result.kind
  return kind === "cache-persistence-failed" || kind === "flushed" ? kind : null
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
