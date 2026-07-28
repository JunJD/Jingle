import {
  ComputerUseActionLedger,
  ComputerUseObservationStore,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  type ComputerUseAuthorizationGrant,
  type ComputerUseBackend,
  type ComputerUseIdentifyRequest,
  type ComputerUseModelObservation,
  type ComputerUseObservation,
  type ComputerUseObservationQueryResult,
  type ComputerUseSemanticAction,
  type ComputerUseTargetIdentity,
  type ComputerUseTraceSink,
  type ComputerUseTransactionResult
} from "@jingle/computer-use-core"
import { createPrismaComputerUseActionLedgerPort } from "../db/computer-use-action-ledger"
import type {
  ComputerUseToolApprovalInput,
  ComputerUseToolApprovalItem
} from "@shared/tool-approval"

export interface ComputerUseSessionSnapshot {
  authorization: ComputerUseAuthorizationGrant
  observation: ComputerUseObservation
  projection: ComputerUseModelObservation
}

export interface ComputerUseExecutionSnapshot {
  projection?: ComputerUseModelObservation
  result: ComputerUseTransactionResult
}

export interface ComputerUseActionApprovalSnapshot {
  review: ComputerUseToolApprovalItem
  signal: AbortSignal
}

export interface ComputerUseApplicationServiceOptions {
  authorizeTarget?: (target: ComputerUseTargetIdentity) => void
  traceSink?: ComputerUseTraceSink
}

interface ComputerUseAuthorizedQueryInput {
  runId: string
  sessionId: string
  stateId: string
  threadId: string
}

export class ComputerUseApplicationService {
  private readonly observations = new ComputerUseObservationStore()
  private readonly scheduler = new ComputerUseResourceScheduler()
  private readonly sessions: ComputerUseSessionManager
  private readonly coordinator: ComputerUseTransactionCoordinator
  private readonly ledger = new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort())
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(
    backend: ComputerUseBackend,
    private readonly options: ComputerUseApplicationServiceOptions = {}
  ) {
    this.sessions = new ComputerUseSessionManager(backend)
    this.coordinator = new ComputerUseTransactionCoordinator(
      backend,
      this.scheduler,
      this.sessions,
      this.ledger,
      this.observations,
      this.options.traceSink
    )
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.assertOpen()
    await this.sessions.setEnabled(enabled)
  }

  async observeAndOpenSession(
    input: ComputerUseIdentifyRequest & {
      runId: string
      threadId: string
      ttlMs?: number
    }
  ): Promise<ComputerUseSessionSnapshot> {
    this.assertOpen()
    input.signal?.throwIfAborted()
    const target = await this.coordinator.identify({
      applicationId: input.applicationId,
      applicationName: input.applicationName,
      signal: input.signal,
      windowId: input.windowId
    })
    input.signal?.throwIfAborted()
    this.options.authorizeTarget?.(target)
    const observation = await this.coordinator.observe({ signal: input.signal, target })
    input.signal?.throwIfAborted()
    const authorization = this.sessions.openSession({
      observation,
      runId: input.runId,
      threadId: input.threadId,
      ttlMs: input.ttlMs
    })
    return {
      authorization,
      observation,
      projection: this.observations.project({ stateId: observation.stateId })
    }
  }

  expand(
    input: ComputerUseAuthorizedQueryInput & { limit?: number; offset?: number }
  ): ComputerUseObservationQueryResult {
    const observation = this.requireAuthorizedObservation(input)
    return this.observations.expand({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      stateId: observation.stateId
    })
  }

  inspect(
    input: ComputerUseAuthorizedQueryInput & { refs: readonly string[] }
  ): ComputerUseObservationQueryResult {
    const observation = this.requireAuthorizedObservation(input)
    return this.observations.inspect({ refs: input.refs, stateId: observation.stateId })
  }

  search(
    input: ComputerUseAuthorizedQueryInput & { limit?: number; query: string }
  ): ComputerUseObservationQueryResult {
    const observation = this.requireAuthorizedObservation(input)
    return this.observations.search({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      query: input.query,
      stateId: observation.stateId
    })
  }

  async execute(input: {
    actions: readonly ComputerUseSemanticAction[]
    baseStateId: string
    runId: string
    sessionId: string
    signal?: AbortSignal
    threadId: string
    transactionId: string
  }): Promise<ComputerUseExecutionSnapshot> {
    this.assertOpen()
    const result = await this.coordinator.execute(input)
    const ownsSuccessor = result.successor
      ? this.observations.get(result.successor.stateId) !== undefined
      : false
    return {
      projection:
        result.successor && ownsSuccessor
          ? this.observations.project({
              baseStateId: input.baseStateId,
              // Native refs are snapshot-local until a platform matcher proves continuity.
              forceFullReason: "external_mutation_uncertain",
              stateId: result.successor.stateId
            })
          : undefined,
      result
    }
  }

  describeActionApproval(
    input: ComputerUseToolApprovalInput & { runId: string; threadId: string }
  ): ComputerUseToolApprovalItem {
    const observation = this.requireAuthorizedObservation(input)
    const elementsByRef = new Map(observation.elements.map((element) => [element.ref, element]))
    for (const action of input.actions) {
      const element = elementsByRef.get(action.ref)
      if (!element?.actions.includes(action.kind)) {
        throw new Error(`Computer-use approval references unavailable semantic ref ${action.ref}.`)
      }
    }
    const referencedElements = [...new Set(input.actions.map((action) => action.ref))].map(
      (ref) => {
        const element = elementsByRef.get(ref)!
        return Object.freeze({
          ...(element.description === undefined ? {} : { description: element.description }),
          ref: element.ref,
          role: element.role,
          ...(element.title === undefined ? {} : { title: element.title })
        })
      }
    )
    return Object.freeze({
      actions: input.actions,
      kind: "computer_use_action",
      sessionId: input.sessionId,
      stateId: input.stateId,
      target: Object.freeze({
        application: Object.freeze({ ...observation.application }),
        elements: Object.freeze(referencedElements),
        window: Object.freeze({
          nativeId: observation.window.nativeId,
          platform: observation.window.platform
        })
      }),
      toolName: "computer_use_action"
    })
  }

  prepareActionApproval(
    input: ComputerUseToolApprovalInput & { runId: string; threadId: string }
  ): ComputerUseActionApprovalSnapshot {
    const review = this.describeActionApproval(input)
    const signal = this.sessions.signal(input.sessionId)
    signal.throwIfAborted()
    return Object.freeze({ review, signal })
  }

  async closeRun(runId: string): Promise<void> {
    this.assertOpen()
    try {
      await this.sessions.closeRun(runId)
    } finally {
      this.ledger.releaseRun(runId)
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    const close = (async () => {
      try {
        await this.sessions.setEnabled(false)
      } finally {
        await this.scheduler.close()
      }
    })()
    this.closePromise = close
    return close.catch((error: unknown) => {
      if (this.closePromise === close) this.closePromise = null
      throw error
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Computer-use application service is closed.")
  }

  private requireAuthorizedObservation(input: ComputerUseAuthorizedQueryInput) {
    this.assertOpen()
    const observation = this.observations.get(input.stateId)
    if (!observation) {
      throw new Error(`Computer-use state ${input.stateId} is missing or was evicted.`)
    }
    this.sessions.assertAuthorized({
      observation,
      runId: input.runId,
      sessionId: input.sessionId,
      threadId: input.threadId
    })
    return observation
  }
}

export function createComputerUseApplicationService(
  backend: ComputerUseBackend,
  options?: ComputerUseApplicationServiceOptions
): ComputerUseApplicationService {
  return new ComputerUseApplicationService(backend, options)
}
