import {
  COMPUTER_USE_NATIVE_RESPONSE_LIMITS,
  getComputerUseRetryDisposition,
  parseComputerUseSemanticActions,
  type ComputerUseSemanticAction,
  type ComputerUseTargetIdentity
} from "@jingle/computer-use-core"
import type {
  JingleComputerUseToolContext,
  RuntimeComputerUseTools
} from "@jingle/langchain-agent-harness"
import { JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION } from "@shared/computer-use-tool-result"
import {
  COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE,
  type ComputerUseSettingsRuntimeStatus
} from "@shared/computer-use-settings"
import {
  parseComputerUseToolApprovalInput,
  type ComputerUseToolApprovalItem
} from "@shared/tool-approval"
import type { AgentConfig } from "../types"
import type { DurableWindowCallerLease } from "../windows/window-identity"
import { createComputerUseApplicationService, type ComputerUseApplicationService } from "./service"
import { createComputerUseTransactionId } from "./transaction-identity"

type ComputerUseConfig = {
  computerUseApplicationAllowlist: readonly string[]
  computerUseEnabled: AgentConfig["computerUseEnabled"]
}

export interface CreateComputerUseRuntimeInput {
  createService: (input: {
    authorizeTarget: (target: ComputerUseTargetIdentity) => void
  }) => Promise<ComputerUseApplicationService>
  initialConfig: ComputerUseConfig
}

interface RunCallerBinding {
  abort: () => void
  lease: DurableWindowCallerLease
  threadId: string
}

export interface ComputerUseActionApprovalAdmission {
  review: ComputerUseToolApprovalItem
  signal: AbortSignal
}

export class ComputerUseRuntime {
  private appliedConfig: Readonly<ComputerUseConfig> | null = null
  private config: Readonly<ComputerUseConfig>
  private configApplicationStatus: ComputerUseSettingsRuntimeStatus = { state: "applied" }
  private configGeneration = 0
  private configQueue = Promise.resolve()
  private readonly cleanupFailures = new Map<string, unknown>()
  private readonly runCallers = new Map<string, RunCallerBinding>()
  private closePromise: Promise<void> | null = null
  private servicePromise: Promise<ComputerUseApplicationService> | null = null
  private closed = false

  constructor(private readonly input: CreateComputerUseRuntimeInput) {
    this.config = normalizeConfig(input.initialConfig)
  }

  applyAgentConfig(config: ComputerUseConfig): Promise<void> {
    this.assertOpen()
    const normalized = normalizeConfig(config)
    const generation = ++this.configGeneration
    this.config = normalized
    if (!this.servicePromise) {
      this.configApplicationStatus = { state: "applied" }
      this.configQueue = this.configQueue.catch(() => undefined)
      return this.configQueue
    }
    if (sameConfig(this.appliedConfig, normalized)) {
      this.configApplicationStatus = { state: "applied" }
      return this.configQueue
    }
    return this.queueConfigApplication(generation)
  }

  getConfigApplicationStatus(): ComputerUseSettingsRuntimeStatus {
    return this.configApplicationStatus
  }

  createToolHandlers(
    callerLease: DurableWindowCallerLease | null
  ): RuntimeComputerUseTools | undefined {
    if (
      this.closed ||
      !callerLease ||
      callerLease.signal.aborted ||
      !this.config.computerUseEnabled ||
      this.config.computerUseApplicationAllowlist.length === 0
    ) {
      return undefined
    }
    return {
      action: (rawInput, context) =>
        this.withAuthorizedCaller(callerLease, context, (service, signal) => {
          const input = parseActionInput(rawInput)
          return service
            .execute({
              actions: input.actions,
              baseStateId: input.stateId,
              runId: context.runId,
              sessionId: input.sessionId,
              signal,
              threadId: context.threadId,
              transactionId: createComputerUseTransactionId({
                runId: context.runId,
                toolCallId: context.toolCallId
              })
            })
            .then(({ projection, result }) => {
              const { successor: _successor, ...modelResult } = result
              return Object.freeze({
                kind: "action" as const,
                ...(projection ? { projection } : {}),
                result: modelResult,
                retry: getComputerUseRetryDisposition(modelResult, input.actions),
                version: JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
              })
            })
        }),
      allowedApplicationIds: this.config.computerUseApplicationAllowlist,
      expand: (rawInput, context) =>
        this.withAuthorizedCaller(callerLease, context, async (service) => {
          const input = parseExpandInput(rawInput)
          return {
            kind: "query" as const,
            operation: "expand" as const,
            result: service.expand({ ...input, runId: context.runId, threadId: context.threadId }),
            version: JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
          }
        }),
      inspect: (rawInput, context) =>
        this.withAuthorizedCaller(callerLease, context, async (service) => {
          const input = parseInspectInput(rawInput)
          return {
            kind: "query" as const,
            operation: "inspect" as const,
            result: service.inspect({ ...input, runId: context.runId, threadId: context.threadId }),
            version: JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
          }
        }),
      observe: (rawInput, context) => {
        const input = parseObserveInput(rawInput)
        this.assertRequestedApplicationAllowed(input.applicationId)
        return this.withAuthorizedCaller(callerLease, context, async (service, signal) => {
          const snapshot = await service.observeAndOpenSession({
            ...input,
            runId: context.runId,
            signal,
            threadId: context.threadId
          })
          return Object.freeze({
            kind: "observe" as const,
            observation: snapshot.projection,
            sessionId: snapshot.authorization.sessionId,
            version: JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
          })
        })
      },
      search: (rawInput, context) =>
        this.withAuthorizedCaller(callerLease, context, async (service) => {
          const input = parseSearchInput(rawInput)
          return {
            kind: "query" as const,
            operation: "search" as const,
            result: service.search({ ...input, runId: context.runId, threadId: context.threadId }),
            version: JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
          }
        })
    }
  }

  async closeRun(runId: string): Promise<void> {
    const binding = this.runCallers.get(runId)
    if (binding) {
      binding.lease.signal.removeEventListener("abort", binding.abort)
      this.runCallers.delete(runId)
    }
    if (!this.servicePromise) {
      this.cleanupFailures.delete(runId)
      return
    }
    try {
      const service = await this.servicePromise
      await service.closeRun(runId)
      this.cleanupFailures.delete(runId)
    } catch (error) {
      this.cleanupFailures.set(runId, error)
      throw error
    }
  }

  getActionApprovalReview(
    rawInput: unknown,
    context: { runId: string; threadId: string },
    callerLease: DurableWindowCallerLease | null
  ): Promise<ComputerUseToolApprovalItem> {
    return this.prepareActionApproval(rawInput, context, callerLease).then(
      (admission) => admission.review
    )
  }

  async prepareActionApproval(
    rawInput: unknown,
    context: { runId: string; threadId: string },
    callerLease: DurableWindowCallerLease | null
  ): Promise<ComputerUseActionApprovalAdmission> {
    const input = parseComputerUseToolApprovalInput(rawInput)
    if (!input) throw new Error("Computer-use approval input is invalid.")
    const prepared = await this.withAuthorizedCaller(
      callerLease,
      {
        runId: context.runId,
        signal: new AbortController().signal,
        threadId: context.threadId,
        toolCallId: "approval"
      },
      async (service) => service.prepareActionApproval({ ...input, ...context })
    )
    if (!callerLease) {
      throw new Error("Computer use requires a live durable window bound to this thread.")
    }
    const signal = AbortSignal.any([callerLease.signal, prepared.signal])
    signal.throwIfAborted()
    return Object.freeze({ review: prepared.review, signal })
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    const close = (async () => {
      for (const [runId, binding] of this.runCallers) {
        binding.lease.signal.removeEventListener("abort", binding.abort)
        this.runCallers.delete(runId)
      }
      let configError: unknown
      try {
        await this.configQueue
      } catch (error) {
        configError = error
        this.configQueue = Promise.resolve()
      }
      let serviceError: unknown
      try {
        if (this.servicePromise) await (await this.servicePromise).close()
      } catch (error) {
        serviceError = error
      }
      if (configError !== undefined && serviceError !== undefined) {
        throw new AggregateError(
          [configError, serviceError],
          "Computer-use configuration and service cleanup both failed."
        )
      }
      if (serviceError !== undefined) throw serviceError
      if (configError !== undefined) throw configError
    })()
    this.closePromise = close
    try {
      await close
    } catch (error) {
      if (this.closePromise === close) this.closePromise = null
      throw error
    }
  }

  private async withAuthorizedCaller<T>(
    callerLease: DurableWindowCallerLease | null,
    context: JingleComputerUseToolContext,
    task: (service: ComputerUseApplicationService, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.assertOpen()
    const cleanupFailure = this.cleanupFailures.get(context.runId)
    if (cleanupFailure !== undefined) throw cleanupFailure
    if (!callerLease || callerLease.signal.aborted || callerLease.threadId !== context.threadId) {
      throw new Error("Computer use requires a live durable window bound to this thread.")
    }
    this.bindRunCaller(context.runId, context.threadId, callerLease)
    const signal = composeSignals(context.signal, callerLease.signal)
    try {
      signal.signal.throwIfAborted()
      const service = await this.getEnabledService()
      signal.signal.throwIfAborted()
      return await task(service, signal.signal)
    } finally {
      signal.dispose()
    }
  }

  private bindRunCaller(runId: string, threadId: string, lease: DurableWindowCallerLease): void {
    const current = this.runCallers.get(runId)
    if (current) {
      if (current.lease !== lease || current.threadId !== threadId) {
        throw new Error("Computer-use run caller lease changed during execution.")
      }
      return
    }
    let revoking = false
    const abort = (): void => {
      if (revoking) return
      revoking = true
      void this.closeRun(runId).catch((error) => {
        this.cleanupFailures.set(runId, error)
        console.error("[ComputerUse] Failed to revoke a run after its caller lease ended.", error)
      })
    }
    this.runCallers.set(runId, { abort, lease, threadId })
    lease.signal.addEventListener("abort", abort, { once: true })
    if (lease.signal.aborted) abort()
  }

  private async getEnabledService(): Promise<ComputerUseApplicationService> {
    await this.configQueue
    if (!this.config.computerUseEnabled) throw new Error("Computer use is disabled in Settings.")
    if (this.config.computerUseApplicationAllowlist.length === 0) {
      throw new Error("Computer use requires at least one allowed application in Settings.")
    }
    if (!this.servicePromise) {
      const creation = this.input.createService({
        authorizeTarget: (target) => this.assertApplicationAllowed(target)
      })
      this.servicePromise = creation
      let service: ComputerUseApplicationService
      try {
        service = await creation
      } catch (error) {
        if (this.servicePromise === creation) this.servicePromise = null
        throw error
      }
      const initialConfig = this.config
      await service.setEnabled(initialConfig.computerUseEnabled)
      if (sameConfig(this.config, initialConfig)) this.appliedConfig = initialConfig
      await this.configQueue
      if (!this.config.computerUseEnabled) {
        throw new Error("Computer use is disabled in Settings.")
      }
      if (this.config.computerUseApplicationAllowlist.length === 0) {
        throw new Error("Computer use requires at least one allowed application in Settings.")
      }
    }
    if (!sameConfig(this.appliedConfig, this.config)) {
      await this.queueConfigApplication(this.configGeneration)
    }
    return this.servicePromise
  }

  private assertApplicationAllowed(target: ComputerUseTargetIdentity): void {
    if (
      !this.config.computerUseEnabled ||
      !this.config.computerUseApplicationAllowlist.includes(target.application.id)
    ) {
      throw new Error("The observed application is not allowed for Computer Use.")
    }
  }

  private assertRequestedApplicationAllowed(applicationId: string): void {
    if (
      !this.config.computerUseEnabled ||
      !this.config.computerUseApplicationAllowlist.includes(applicationId)
    ) {
      throw new Error("The requested application is not allowed for Computer Use.")
    }
  }

  private async applyConfigToLiveService(service: ComputerUseApplicationService): Promise<void> {
    const desired = this.config
    if (sameConfig(this.appliedConfig, desired)) return
    await service.setEnabled(false)
    if (desired.computerUseEnabled) await service.setEnabled(true)
    if (sameConfig(this.config, desired)) this.appliedConfig = desired
  }

  private queueConfigApplication(generation: number): Promise<void> {
    const servicePromise = this.servicePromise
    this.appliedConfig = null
    this.configApplicationStatus = { state: "applying" }
    const apply = async (): Promise<void> => {
      if (!servicePromise) return
      let service: ComputerUseApplicationService
      try {
        service = await servicePromise
      } catch (error) {
        this.markConfigApplicationRetryRequired(generation)
        throw error
      }
      try {
        await this.applyConfigToLiveService(service)
        if (this.configGeneration === generation) {
          this.configApplicationStatus = { state: "applied" }
        }
      } catch (error) {
        this.markConfigApplicationRetryRequired(generation)
        throw error
      }
    }
    this.configQueue = this.configQueue.then(apply, apply)
    return this.configQueue
  }

  private markConfigApplicationRetryRequired(generation: number): void {
    if (this.configGeneration !== generation) return
    this.configApplicationStatus = {
      diagnosticCode: COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE,
      retryable: true,
      state: "retry_required"
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Computer-use runtime is closed.")
  }
}

export function createComputerUseRuntime(input: CreateComputerUseRuntimeInput): ComputerUseRuntime {
  return new ComputerUseRuntime(input)
}

export function createComputerUseRuntimeWithBackend(
  backend: Parameters<typeof createComputerUseApplicationService>[0],
  config: ComputerUseConfig
): ComputerUseRuntime {
  return createComputerUseRuntime({
    createService: async ({ authorizeTarget }) =>
      createComputerUseApplicationService(backend, { authorizeTarget }),
    initialConfig: config
  })
}

function normalizeConfig(config: ComputerUseConfig): Readonly<ComputerUseConfig> {
  return Object.freeze({
    computerUseApplicationAllowlist: Object.freeze([
      ...new Set(
        config.computerUseApplicationAllowlist.map((entry) => entry.trim()).filter(Boolean)
      )
    ]),
    computerUseEnabled: config.computerUseEnabled === true
  })
}

function sameConfig(left: ComputerUseConfig | null, right: ComputerUseConfig | null): boolean {
  if (!left || !right) return left === right
  return (
    left.computerUseEnabled === right.computerUseEnabled &&
    left.computerUseApplicationAllowlist.length === right.computerUseApplicationAllowlist.length &&
    left.computerUseApplicationAllowlist.every(
      (entry, index) => entry === right.computerUseApplicationAllowlist[index]
    )
  )
}

function parseObserveInput(value: unknown): {
  applicationId: string
  applicationName?: string
  windowId?: string
} {
  const input = exactRecord(value, ["applicationId", "applicationName", "windowId"], "observe")
  const applicationId = requiredString(input.applicationId, "applicationId")
  const applicationName = optionalString(
    input.applicationName,
    "applicationName",
    COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text
  )
  const windowId = optionalString(input.windowId, "windowId")
  return {
    applicationId,
    ...(applicationName ? { applicationName } : {}),
    ...(windowId ? { windowId } : {})
  }
}

function parseActionInput(value: unknown): {
  actions: readonly ComputerUseSemanticAction[]
  sessionId: string
  stateId: string
} {
  const input = exactRecord(value, ["actions", "sessionId", "stateId"], "action")
  return {
    actions: parseComputerUseSemanticActions(input.actions, "computer-use tool actions"),
    sessionId: requiredString(input.sessionId, "sessionId"),
    stateId: requiredString(input.stateId, "stateId")
  }
}

function parseSearchInput(value: unknown): {
  limit?: number
  query: string
  sessionId: string
  stateId: string
} {
  const input = exactRecord(value, ["limit", "query", "sessionId", "stateId"], "search")
  return {
    ...(input.limit === undefined ? {} : { limit: boundedInteger(input.limit, "limit", 1, 100) }),
    query: requiredString(input.query, "query", COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text),
    sessionId: requiredString(input.sessionId, "sessionId"),
    stateId: requiredString(input.stateId, "stateId")
  }
}

function parseExpandInput(value: unknown): {
  limit?: number
  offset?: number
  sessionId: string
  stateId: string
} {
  const input = exactRecord(value, ["limit", "offset", "sessionId", "stateId"], "expand")
  return {
    ...(input.limit === undefined ? {} : { limit: boundedInteger(input.limit, "limit", 1, 100) }),
    ...(input.offset === undefined
      ? {}
      : { offset: boundedInteger(input.offset, "offset", 0, Number.MAX_SAFE_INTEGER) }),
    sessionId: requiredString(input.sessionId, "sessionId"),
    stateId: requiredString(input.stateId, "stateId")
  }
}

function parseInspectInput(value: unknown): {
  refs: readonly string[]
  sessionId: string
  stateId: string
} {
  const input = exactRecord(value, ["refs", "sessionId", "stateId"], "inspect")
  if (!Array.isArray(input.refs) || input.refs.length < 1 || input.refs.length > 100) {
    throw new Error("Computer-use inspect refs must contain between 1 and 100 refs.")
  }
  const refs = input.refs.map((ref, index) => requiredString(ref, `refs[${index}]`))
  if (new Set(refs).size !== refs.length) {
    throw new Error("Computer-use inspect refs must be unique.")
  }
  return {
    refs,
    sessionId: requiredString(input.sessionId, "sessionId"),
    stateId: requiredString(input.stateId, "stateId")
  }
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  operation: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Computer-use ${operation} input must be an object.`)
  }
  const input = value as Record<string, unknown>
  const allowed = new Set(allowedKeys)
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error(`Computer-use ${operation} input contains an unknown field.`)
  }
  return input
}

function requiredString(
  value: unknown,
  field: string,
  maximum: number = COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > maximum) {
    throw new Error(`Computer-use ${field} must be a canonical non-empty string.`)
  }
  return value
}

function optionalString(value: unknown, field: string, maximum?: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, field, maximum)
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Computer-use ${field} is outside its allowed range.`)
  }
  return value as number
}

function composeSignals(
  left: AbortSignal,
  right: AbortSignal
): {
  dispose: () => void
  signal: AbortSignal
} {
  return {
    dispose: () => undefined,
    signal: AbortSignal.any([left, right])
  }
}
