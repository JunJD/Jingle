import type { ComputerUseActionEvidence, ComputerUseOutcome } from "./contract"

export type ComputerUseAttemptPhase = "queued" | "dispatched" | "settled"

export interface ComputerUseActionAttempt {
  attemptId: string
  evidence?: ComputerUseActionEvidence
  outcome?: ComputerUseOutcome
  phase: ComputerUseAttemptPhase
  runId: string
  sessionId: string
  startedAt: number
  settledAt?: number
}

export interface ComputerUseActionLedgerPort {
  reserve(attempt: ComputerUseActionAttempt): Promise<"reserved" | "exists">
  write(attempt: ComputerUseActionAttempt): Promise<void>
}

export class ComputerUseActionLedger {
  private readonly attempts = new Map<string, ComputerUseActionAttempt>()

  constructor(private readonly port: ComputerUseActionLedgerPort) {}

  async begin(input: {
    runId: string
    sessionId: string
    transactionId: string
  }): Promise<ComputerUseActionAttempt> {
    const transactionId = input.transactionId.trim()
    if (!transactionId) throw new Error("Computer-use transactionId must not be empty.")
    if (this.attempts.has(transactionId)) {
      throw new Error(`Computer-use transaction ${transactionId} was already attempted.`)
    }
    const attempt: ComputerUseActionAttempt = {
      attemptId: transactionId,
      phase: "queued",
      runId: input.runId,
      sessionId: input.sessionId,
      startedAt: Date.now()
    }
    if ((await this.port.reserve(attempt)) === "exists") {
      throw new Error(`Computer-use transaction ${transactionId} was already attempted.`)
    }
    this.attempts.set(attempt.attemptId, attempt)
    return attempt
  }

  async dispatched(attemptId: string): Promise<void> {
    const attempt = this.require(attemptId)
    await this.persist({ ...attempt, phase: "dispatched" })
  }

  async settle(
    attemptId: string,
    outcome: ComputerUseOutcome,
    evidence?: ComputerUseActionEvidence
  ): Promise<void> {
    const attempt = this.require(attemptId)
    await this.persist({
      ...attempt,
      evidence,
      outcome,
      phase: "settled",
      settledAt: Date.now()
    })
  }

  async cancel(attemptId: string): Promise<ComputerUseOutcome> {
    const attempt = this.require(attemptId)
    const outcome: ComputerUseOutcome =
      attempt.phase === "queued" ? "cancelled_before_dispatch" : "unknown"
    await this.settle(attemptId, outcome)
    return outcome
  }

  get(attemptId: string): ComputerUseActionAttempt | undefined {
    return this.attempts.get(attemptId)
  }

  private require(attemptId: string): ComputerUseActionAttempt {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) throw new Error(`Unknown computer-use action attempt ${attemptId}.`)
    return attempt
  }

  private async persist(attempt: ComputerUseActionAttempt): Promise<void> {
    this.attempts.set(attempt.attemptId, attempt)
    await this.port.write(attempt)
  }
}
