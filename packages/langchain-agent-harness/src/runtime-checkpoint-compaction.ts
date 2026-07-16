import type { RunnableConfig } from "@langchain/core/runnables"
import type { BaseMessage } from "@langchain/core/messages"
import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple
} from "@langchain/langgraph-checkpoint"
import type { RuntimeCompaction } from "./runtime-state"
import { parseRuntimeCompactInput } from "./runtime-operation"
import type { RuntimeCompactInput, RuntimeCompactResult } from "./runtime-operation"

export const RUNTIME_COMPACTION_COMMIT_METADATA_KEY = "runtime_compaction_commit"

export class CompactCheckpointNotFound extends Error {
  constructor(threadId: string) {
    super(`[RuntimeCompact] No checkpoint exists for thread "${threadId}".`)
    this.name = "CompactCheckpointNotFound"
  }
}

export type CompactBoundaryInstability = "pending-hitl" | "pending-writes"

export class CompactBoundaryNotStable extends Error {
  readonly checkpointId: string
  readonly reason: CompactBoundaryInstability

  constructor(checkpointId: string, reason: CompactBoundaryInstability) {
    super(
      reason === "pending-hitl"
        ? `[RuntimeCompact] Checkpoint "${checkpointId}" has a pending HITL interrupt.`
        : `[RuntimeCompact] Checkpoint "${checkpointId}" has pending writes.`
    )
    this.name = "CompactBoundaryNotStable"
    this.checkpointId = checkpointId
    this.reason = reason
  }
}

export class CompactCheckpointConflict extends Error {
  readonly actualCheckpointId: string | null
  readonly expectedCheckpointId: string

  constructor(expectedCheckpointId: string, actualCheckpointId: string | null) {
    super(
      `[RuntimeCompact] Expected checkpoint "${expectedCheckpointId}", but latest checkpoint is "${actualCheckpointId ?? "<missing>"}".`
    )
    this.name = "CompactCheckpointConflict"
    this.actualCheckpointId = actualCheckpointId
    this.expectedCheckpointId = expectedCheckpointId
  }
}

export class CompactOperationIdentityConflict extends Error {
  readonly operationId: string

  constructor(operationId: string) {
    super(`[RuntimeCompact] Operation "${operationId}" was already committed with different input.`)
    this.name = "CompactOperationIdentityConflict"
    this.operationId = operationId
  }
}

export interface RuntimeCompactRequestIdentity {
  modelId: string
  preserveLastUserMessageCount: number | null
  preserveLastUserMessageCountPresent: boolean
  reason: string | null
  trigger: "manual"
}

export interface RuntimeCompactionCommitMetadata extends RuntimeCompactRequestIdentity {
  expectedCheckpointId: string
  messageCountAfterCompaction: number
  messageCountBeforeCompaction: number
  operationId: string
}

export interface RuntimeCheckpointCompactionEnvelope {
  checkpoint: Checkpoint
  config: RunnableConfig
  metadata: CheckpointMetadata
  parentConfig?: RunnableConfig
  pendingWrites: NonNullable<CheckpointTuple["pendingWrites"]>
}

export interface RuntimeCheckpointCompactionOwnedValues {
  _summarizationEvent: unknown
  _summarizationSessionId: string
  compactions: RuntimeCompaction[]
  messages: BaseMessage[]
}

export interface RuntimeCheckpointCompactionReceipt
  extends RuntimeCompactResult, RuntimeCompactRequestIdentity {
  expectedCheckpointId: string
  operationId: string
}

export type RuntimeCheckpointCompactionPrepareResult =
  | { status: "not-found" }
  | {
      checkpointId: string
      reason: CompactBoundaryInstability
      status: "unstable"
    }
  | { envelope: RuntimeCheckpointCompactionEnvelope; status: "ready" }

export type RuntimeCheckpointCompactionCommitResult =
  | { actualCheckpointId: string | null; status: "conflict" }
  | { receipt: RuntimeCheckpointCompactionReceipt; status: "committed" }
  | { receipt: RuntimeCheckpointCompactionReceipt; status: "already-committed" }
  | { status: "not-found" }
  | {
      checkpointId: string
      reason: CompactBoundaryInstability
      status: "unstable"
    }

export interface RuntimeCheckpointCompactionStore {
  commit(input: {
    commitMetadataKey: typeof RUNTIME_COMPACTION_COMMIT_METADATA_KEY
    envelope: RuntimeCheckpointCompactionEnvelope
    metadata: RuntimeCompactionCommitMetadata
    ownedValues: RuntimeCheckpointCompactionOwnedValues
    threadId: string
  }): Promise<RuntimeCheckpointCompactionCommitResult>
  prepare(input: { threadId: string }): Promise<RuntimeCheckpointCompactionPrepareResult>
  readCommitted(input: {
    operationId: string
    threadId: string
  }): Promise<RuntimeCheckpointCompactionReceipt | null>
}

export function createRuntimeCompactRequestIdentity(
  input: Readonly<RuntimeCompactInput>
): Readonly<RuntimeCompactRequestIdentity> {
  const canonical = parseRuntimeCompactInput(input)
  const preserveLastUserMessageCountPresent = Object.hasOwn(
    canonical,
    "preserveLastUserMessageCount"
  )
  return Object.freeze({
    modelId: canonical.modelId,
    preserveLastUserMessageCount: canonical.preserveLastUserMessageCount ?? null,
    preserveLastUserMessageCountPresent,
    reason: canonical.reason ?? null,
    trigger: "manual"
  })
}

export function assertRuntimeCompactRequestIdentity(
  committed: RuntimeCompactRequestIdentity,
  requested: RuntimeCompactRequestIdentity,
  operationId: string
): void {
  if (
    committed.modelId !== requested.modelId ||
    committed.preserveLastUserMessageCount !== requested.preserveLastUserMessageCount ||
    committed.preserveLastUserMessageCountPresent !==
      requested.preserveLastUserMessageCountPresent ||
    committed.reason !== requested.reason ||
    committed.trigger !== requested.trigger
  ) {
    throw new CompactOperationIdentityConflict(operationId)
  }
}

export function readRuntimeCompactionCommitMetadata(
  metadata: CheckpointMetadata
): RuntimeCompactionCommitMetadata | null {
  const value = (metadata as Record<string, unknown>)[RUNTIME_COMPACTION_COMMIT_METADATA_KEY]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const identity = readRuntimeCompactRequestIdentity(record)
  return identity &&
    typeof record.operationId === "string" &&
    record.operationId.length > 0 &&
    record.operationId === record.operationId.trim() &&
    typeof record.expectedCheckpointId === "string" &&
    record.expectedCheckpointId.length > 0 &&
    isMessageCount(record.messageCountBeforeCompaction) &&
    isMessageCount(record.messageCountAfterCompaction)
    ? {
        ...identity,
        expectedCheckpointId: record.expectedCheckpointId,
        messageCountAfterCompaction: record.messageCountAfterCompaction,
        messageCountBeforeCompaction: record.messageCountBeforeCompaction,
        operationId: record.operationId
      }
    : null
}

function readRuntimeCompactRequestIdentity(
  record: Record<string, unknown>
): RuntimeCompactRequestIdentity | null {
  const preserveLastUserMessageCount = record.preserveLastUserMessageCount
  const preserveLastUserMessageCountPresent = record.preserveLastUserMessageCountPresent
  if (
    typeof record.modelId !== "string" ||
    record.modelId.length === 0 ||
    record.modelId !== record.modelId.trim() ||
    (record.reason !== null && typeof record.reason !== "string") ||
    typeof preserveLastUserMessageCountPresent !== "boolean" ||
    (preserveLastUserMessageCount !== null && !isMessageCount(preserveLastUserMessageCount)) ||
    (!preserveLastUserMessageCountPresent && preserveLastUserMessageCount !== null) ||
    record.trigger !== "manual"
  ) {
    return null
  }

  return {
    modelId: record.modelId,
    preserveLastUserMessageCount,
    preserveLastUserMessageCountPresent,
    reason: record.reason,
    trigger: "manual"
  }
}

export function checkpointHasPendingRuntimeInterrupt(checkpoint: Checkpoint): boolean {
  const interrupts = checkpoint.channel_values.__interrupt__
  if (interrupts === undefined) return false
  return !Array.isArray(interrupts) || interrupts.length > 0
}

function isMessageCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
