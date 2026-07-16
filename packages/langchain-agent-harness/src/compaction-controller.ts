import { messagesStateReducer } from "@langchain/langgraph"
import {
  CompactPrepareNode,
  CompactSummarizeNode,
  type CompactSummarizeUpdate
} from "./harness-runtime/graph/nodes"
import { type JingleSummarizationController } from "./harness-runtime/summarization"
import type {
  RuntimeCompactInput,
  RuntimeCompactOperation,
  RuntimeCompactResult
} from "./runtime-operation"
import { parseRuntimeCompactInput } from "./runtime-operation"
import {
  assertRuntimeCompactRequestIdentity,
  CompactBoundaryNotStable,
  CompactCheckpointConflict,
  CompactCheckpointNotFound,
  createRuntimeCompactRequestIdentity,
  checkpointHasPendingRuntimeInterrupt,
  RUNTIME_COMPACTION_COMMIT_METADATA_KEY,
  type RuntimeCompactRequestIdentity,
  type RuntimeCheckpointCompactionReceipt,
  type RuntimeCheckpointCompactionStore
} from "./runtime-checkpoint-compaction"
import type { RuntimeCheckpointState, RuntimeCompaction } from "./runtime-state"
import type { RuntimeThreadScope } from "./runtime-scope"

export type JingleCompactionInput = RuntimeCompactInput
export type JingleCompactionRunContext = RuntimeThreadScope & Pick<RuntimeCompactInput, "modelId">

export interface JingleCompactionRuntimeState {
  _summarizationEvent?: unknown
  _summarizationSessionId?: unknown
  compactions?: unknown
  messages?: unknown
}

export type JingleCompactionResult = RuntimeCompactResult

export interface CreateJingleCompactionControllerInput {
  checkpointStore: RuntimeCheckpointCompactionStore
  summarization: (scope: JingleCompactionRunContext) => JingleSummarizationController
}

export interface JingleCompactionController {
  compact(
    input: JingleCompactionInput & JingleCompactionRunContext
  ): Promise<JingleCompactionResult>
}

export function createJingleCompactionController(
  input: CreateJingleCompactionControllerInput
): JingleCompactionController {
  const prepareNode = new CompactPrepareNode()

  return {
    compact: async (compactInput) => {
      const admittedRequest = snapshotCompactionRequest(compactInput)
      const admittedInput = parseRuntimeCompactInput(admittedRequest)
      const scope = readCompactionRunContext(admittedRequest)
      const requestIdentity = createRuntimeCompactRequestIdentity(admittedInput)
      const operationId = admittedInput.operationId
      const committed = await input.checkpointStore.readCommitted({
        operationId,
        threadId: scope.threadId
      })
      if (committed) return readMatchingCompactResult(committed, requestIdentity)

      const operation: RuntimeCompactOperation = {
        kind: "compact",
        modelId: admittedInput.modelId,
        operationId,
        preserveLastUserMessageCount: admittedInput.preserveLastUserMessageCount,
        reason: admittedInput.reason,
        runId: operationId,
        threadId: scope.threadId,
        trigger: admittedInput.trigger,
        workspacePath: scope.workspacePath
      }
      const preparedCheckpoint = await input.checkpointStore.prepare({
        threadId: operation.threadId
      })
      if (preparedCheckpoint.status === "not-found") {
        throw new CompactCheckpointNotFound(operation.threadId)
      }
      if (preparedCheckpoint.status === "unstable") {
        throw new CompactBoundaryNotStable(
          preparedCheckpoint.checkpointId,
          preparedCheckpoint.reason
        )
      }

      const { envelope } = preparedCheckpoint
      if (checkpointHasPendingRuntimeInterrupt(envelope.checkpoint)) {
        throw new CompactBoundaryNotStable(envelope.checkpoint.id, "pending-hitl")
      }
      const state = envelope.checkpoint.channel_values as JingleCompactionRuntimeState
      const runtimeState = readRuntimeState(state)
      const preparedWithState = prepareNode.invoke(
        { checkpointConfig: envelope.config },
        {
          operation,
          state: runtimeState
        }
      )
      const planWithState = preparedWithState.privateState.compactPlan
      const summarized = await new CompactSummarizeNode(
        input.summarization({ modelId: admittedInput.modelId, ...scope })
      ).invoke(
        { plan: planWithState },
        {
          operation,
          scratch: {
            compactPlan: planWithState
          },
          state: runtimeState
        }
      )
      const compactUpdate = summarized.stateUpdate as CompactSummarizeUpdate
      const compaction = {
        ...(compactUpdate.compactions[0] as RuntimeCompaction),
        compactionId: operationId
      }
      const messageCountAfterCompaction = summarized.privateState.messageCountAfterCompaction
      const commitResult = await input.checkpointStore.commit({
        commitMetadataKey: RUNTIME_COMPACTION_COMMIT_METADATA_KEY,
        envelope,
        metadata: {
          ...requestIdentity,
          expectedCheckpointId: envelope.checkpoint.id,
          messageCountAfterCompaction,
          messageCountBeforeCompaction: planWithState.messages.length,
          operationId
        },
        ownedValues: {
          _summarizationEvent: compactUpdate._summarizationEvent,
          _summarizationSessionId: compactUpdate._summarizationSessionId,
          compactions: upsertCompaction(runtimeState.compactions, compaction),
          messages: messagesStateReducer(runtimeState.messages, compactUpdate.messages ?? [])
        },
        threadId: operation.threadId
      })
      if (commitResult.status === "not-found") {
        throw new CompactCheckpointNotFound(operation.threadId)
      }
      if (commitResult.status === "unstable") {
        throw new CompactBoundaryNotStable(commitResult.checkpointId, commitResult.reason)
      }
      if (commitResult.status === "conflict") {
        throw new CompactCheckpointConflict(envelope.checkpoint.id, commitResult.actualCheckpointId)
      }
      if (commitResult.status === "already-committed") {
        return readMatchingCompactResult(commitResult.receipt, requestIdentity)
      }

      return readMatchingCompactResult(commitResult.receipt, requestIdentity)
    }
  }
}

function snapshotCompactionRequest(input: unknown): Readonly<Record<PropertyKey, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("[RuntimeCompact] input must be an object.")
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error("[RuntimeCompact] input must be a plain object.")
  }

  const snapshot: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("[RuntimeCompact] input must contain data properties only.")
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: descriptor.enumerable,
      value: descriptor.value,
      writable: false
    })
  }
  return Object.freeze(snapshot)
}

function readCompactionRunContext(
  input: Readonly<Record<PropertyKey, unknown>>
): RuntimeThreadScope {
  return {
    threadId: readCompactionScopeField(input, "threadId"),
    workspacePath: readCompactionScopeField(input, "workspacePath")
  }
}

function readCompactionScopeField(input: object, field: keyof RuntimeThreadScope): string {
  const descriptor = Object.getOwnPropertyDescriptor(input, field)
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new Error(`[RuntimeCompact] ${field} must be an own string data property.`)
  }
  if (descriptor.value.length === 0) {
    throw new Error(`[RuntimeCompact] ${field} must not be empty.`)
  }
  return descriptor.value
}

function readCompactResult(receipt: RuntimeCheckpointCompactionReceipt): JingleCompactionResult {
  return {
    checkpointConfig: receipt.checkpointConfig,
    compaction: receipt.compaction,
    messageCountAfterCompaction: receipt.messageCountAfterCompaction,
    messageCountBeforeCompaction: receipt.messageCountBeforeCompaction
  }
}

function readMatchingCompactResult(
  receipt: RuntimeCheckpointCompactionReceipt,
  requestIdentity: RuntimeCompactRequestIdentity
): JingleCompactionResult {
  assertRuntimeCompactRequestIdentity(receipt, requestIdentity, receipt.operationId)
  return readCompactResult(receipt)
}

function readRuntimeState(state: JingleCompactionRuntimeState): RuntimeCheckpointState {
  if (!Array.isArray(state.messages)) {
    throw new Error("[RuntimeCompact] Checkpoint messages channel is missing or invalid.")
  }
  if (state.compactions !== undefined && !Array.isArray(state.compactions)) {
    throw new Error("[RuntimeCompact] Checkpoint compactions channel is invalid.")
  }

  return {
    ...state,
    compactions: state.compactions ?? [],
    messages: state.messages
  } as RuntimeCheckpointState
}

function upsertCompaction(
  existing: readonly RuntimeCompaction[],
  compaction: RuntimeCompaction
): RuntimeCompaction[] {
  return [...existing.filter((item) => item.compactionId !== compaction.compactionId), compaction]
}
