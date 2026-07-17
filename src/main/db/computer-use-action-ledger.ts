import {
  Prisma,
  type ComputerUseAttempt as ComputerUseAttemptRow,
  type PrismaClient
} from "@prisma/client"
import {
  parseComputerUseActionAttempt,
  type ComputerUseActionAttempt,
  type ComputerUseActionLedgerPort,
  type ComputerUseActionLedgerPortTransition
} from "@jingle/computer-use-core"
import { getPrismaClient } from "./client"

export class PrismaComputerUseActionLedgerPort implements ComputerUseActionLedgerPort {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async read(attemptId: string): Promise<ComputerUseActionAttempt | undefined> {
    const row = await this.prisma.computerUseAttempt.findUnique({ where: { attemptId } })
    return row ? decodeComputerUseAttempt(row) : undefined
  }

  async reserve(
    attempt: ComputerUseActionAttempt
  ): Promise<Awaited<ReturnType<ComputerUseActionLedgerPort["reserve"]>>> {
    const normalized = parseComputerUseActionAttempt(attempt, attempt.attemptId)
    if (normalized.phase !== "queued" || normalized.revision !== 0) {
      throw new Error("Computer-use action attempt reservation must start queued at revision 0.")
    }

    try {
      await this.prisma.computerUseAttempt.create({
        data: encodeComputerUseAttempt(normalized)
      })
      return { status: "reserved" }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }

    const current = await this.prisma.computerUseAttempt.findUnique({
      where: { attemptId: normalized.attemptId }
    })
    if (!current) {
      throw new Error(
        `Computer-use action attempt ${normalized.attemptId} disappeared after reservation conflict.`
      )
    }
    return { attempt: decodeComputerUseAttempt(current), status: "exists" }
  }

  async transition(input: {
    attempt: ComputerUseActionAttempt
    expectedPhase: "queued" | "dispatched"
    expectedRevision: number
  }): Promise<ComputerUseActionLedgerPortTransition> {
    const normalized = parseComputerUseActionAttempt(input.attempt, input.attempt.attemptId)
    assertTransitionHistory(normalized, input.expectedPhase, input.expectedRevision)
    const updated = await this.prisma.computerUseAttempt.updateMany({
      data: {
        payloadJson: JSON.stringify(normalized),
        phase: normalized.phase,
        revision: normalized.revision
      },
      where: {
        attemptId: normalized.attemptId,
        phase: input.expectedPhase,
        revision: input.expectedRevision
      }
    })
    if (updated.count === 1) return { status: "applied" }

    const current = await this.prisma.computerUseAttempt.findUnique({
      where: { attemptId: normalized.attemptId }
    })
    if (!current) {
      throw new Error(`Computer-use action attempt ${normalized.attemptId} is missing.`)
    }
    return { current: decodeComputerUseAttempt(current), status: "conflict" }
  }
}

export function createPrismaComputerUseActionLedgerPort(): ComputerUseActionLedgerPort {
  return new PrismaComputerUseActionLedgerPort()
}

function encodeComputerUseAttempt(attempt: ComputerUseActionAttempt): ComputerUseAttemptRow {
  return {
    attemptId: attempt.attemptId,
    payloadJson: JSON.stringify(attempt),
    phase: attempt.phase,
    revision: attempt.revision
  }
}

function decodeComputerUseAttempt(row: ComputerUseAttemptRow): ComputerUseActionAttempt {
  try {
    const attempt = parseComputerUseActionAttempt(JSON.parse(row.payloadJson), row.attemptId)
    if (attempt.phase !== row.phase || attempt.revision !== row.revision) {
      throw new Error("Persisted phase or revision disagrees with its canonical payload.")
    }
    return attempt
  } catch (error) {
    throw new Error(`Persisted computer-use action attempt ${row.attemptId} is corrupt.`, {
      cause: error
    })
  }
}

function assertTransitionHistory(
  attempt: ComputerUseActionAttempt,
  expectedPhase: "queued" | "dispatched",
  expectedRevision: number
): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Computer-use transition expectedRevision must be a non-negative integer.")
  }
  if (attempt.revision !== expectedRevision + 1) {
    throw new Error("Computer-use transition must advance exactly one revision.")
  }
  if (
    (expectedPhase === "queued" && !["dispatched", "settled"].includes(attempt.phase)) ||
    (expectedPhase === "dispatched" && attempt.phase !== "settled")
  ) {
    throw new Error(
      `Computer-use transition cannot move from ${expectedPhase} to ${attempt.phase}.`
    )
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
