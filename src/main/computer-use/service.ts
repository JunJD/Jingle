import {
  ComputerUseActionLedger,
  ComputerUseObservationStore,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  type ComputerUseAuthorizationGrant,
  type ComputerUseBackend,
  type ComputerUseModelObservation,
  type ComputerUseObserveRequest,
  type ComputerUseObservation,
  type ComputerUseSemanticAction,
  type ComputerUseTransactionResult
} from "@jingle/computer-use-core"
import { createPrismaComputerUseActionLedgerPort } from "../db/computer-use-action-ledger"

export interface ComputerUseSessionSnapshot {
  authorization: ComputerUseAuthorizationGrant
  observation: ComputerUseObservation
  projection: ComputerUseModelObservation
}

export interface ComputerUseExecutionSnapshot {
  projection?: ComputerUseModelObservation
  result: ComputerUseTransactionResult
}

export class ComputerUseApplicationService {
  private readonly observations = new ComputerUseObservationStore()
  private readonly scheduler = new ComputerUseResourceScheduler()
  private readonly sessions: ComputerUseSessionManager
  private readonly coordinator: ComputerUseTransactionCoordinator
  private closePromise: Promise<void> | null = null

  constructor(backend: ComputerUseBackend) {
    this.sessions = new ComputerUseSessionManager(backend)
    this.coordinator = new ComputerUseTransactionCoordinator(
      backend,
      this.scheduler,
      this.sessions,
      new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort()),
      this.observations
    )
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.assertOpen()
    await this.sessions.setEnabled(enabled)
  }

  async observeAndOpenSession(
    input: ComputerUseObserveRequest & {
      runId: string
      threadId: string
      ttlMs?: number
    }
  ): Promise<ComputerUseSessionSnapshot> {
    this.assertOpen()
    input.signal?.throwIfAborted()
    const observation = await this.coordinator.observe({
      applicationId: input.applicationId,
      applicationName: input.applicationName,
      signal: input.signal,
      windowId: input.windowId
    })
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

  async closeRun(runId: string): Promise<void> {
    this.assertOpen()
    await this.sessions.closeRun(runId)
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = (async () => {
      try {
        await this.sessions.setEnabled(false)
      } finally {
        await this.scheduler.close()
      }
    })()
    return this.closePromise
  }

  private assertOpen(): void {
    if (this.closePromise) throw new Error("Computer-use application service is closed.")
  }
}

export function createComputerUseApplicationService(
  backend: ComputerUseBackend
): ComputerUseApplicationService {
  return new ComputerUseApplicationService(backend)
}
