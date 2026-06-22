import { randomUUID } from "crypto"
import { getPrismaClient } from "./client"
import { markAgentTraceProjectionError, projectAgentTraceForRun } from "./agent-traces"
import { serializeJsonValue, toNumber } from "./utils"
import { normalizeAgentEventPayload, type AgentEventType } from "../agent-events/schema"
import { createProjectionQueue } from "../projection/projection-queue"

export type AgentEventAggregateType = "run" | "thread"

export interface AgentEventRow {
  aggregate_id: string
  aggregate_type: AgentEventAggregateType
  checkpoint_id: string | null
  created_at: number
  event_id: string
  metadata: string | null
  payload: string
  run_id: string | null
  schema_version: number
  seq: number
  thread_id: string
  trace_id: string | null
  type: string
}

export interface AppendAgentEventInput {
  aggregateId?: string
  aggregateType?: AgentEventAggregateType
  checkpointId?: string | null
  eventId?: string
  metadata?: Record<string, unknown> | string | null
  payload?: Record<string, unknown> | string | null
  /**
   * undefined: mark the run dirty for an explicit flush.
   * true: schedule projection work in the background.
   * false: leave projection state untouched.
   */
  projectTrace?: boolean
  runId?: string | null
  schemaVersion?: number
  threadId: string
  traceId?: string | null
  type: AgentEventType
}

const AGENT_TRACE_PROJECTION_DEBOUNCE_MS = 500
const agentTraceProjectionQueue = createProjectionQueue<string>({
  debounceMs: AGENT_TRACE_PROJECTION_DEBOUNCE_MS,
  getKey: (runId) => runId,
  name: "AgentTraceProjector",
  onError: async (runId, error) => {
    const message = error instanceof Error ? error.message : String(error)
    await markAgentTraceProjectionError(runId, message)
  },
  run: async (runId) => {
    await projectAgentTraceForRun(runId)
  },
  stateKey: "agent-trace"
})

export function enqueueAgentTraceProjection(runId: string): void {
  agentTraceProjectionQueue.enqueue(runId)
}

function markAgentTraceProjectionDirty(runId: string): void {
  agentTraceProjectionQueue.markDirty(runId)
}

export async function flushAgentTraceProjection(): Promise<void> {
  await agentTraceProjectionQueue.flush()
}

function mapAgentEventRow(row: {
  aggregateId: string
  aggregateType: string
  checkpointId: string | null
  createdAt: bigint
  eventId: string
  metadata: string | null
  payload: string
  runId: string | null
  schemaVersion: number
  seq: number
  threadId: string
  traceId: string | null
  type: string
}): AgentEventRow {
  return {
    aggregate_id: row.aggregateId,
    aggregate_type: row.aggregateType as AgentEventAggregateType,
    checkpoint_id: row.checkpointId,
    created_at: toNumber(row.createdAt),
    event_id: row.eventId,
    metadata: row.metadata,
    payload: row.payload,
    run_id: row.runId,
    schema_version: row.schemaVersion,
    seq: row.seq,
    thread_id: row.threadId,
    trace_id: row.traceId,
    type: row.type
  }
}

function resolveAggregate(input: AppendAgentEventInput): {
  aggregateId: string
  aggregateType: AgentEventAggregateType
} {
  if (input.aggregateId && input.aggregateType) {
    return {
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType
    }
  }

  if (input.runId) {
    return {
      aggregateId: input.runId,
      aggregateType: "run"
    }
  }

  return {
    aggregateId: input.threadId,
    aggregateType: "thread"
  }
}

export async function appendAgentEvent(input: AppendAgentEventInput): Promise<AgentEventRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const aggregate = resolveAggregate(input)
  const payload = serializeJsonValue(normalizeAgentEventPayload(input.type, input.payload)) ?? "{}"
  const metadata = serializeJsonValue(input.metadata) ?? null

  const row = await prisma.$transaction(async (tx) => {
    const sequence = await tx.agentEventSequence.upsert({
      where: {
        aggregateId: aggregate.aggregateId
      },
      create: {
        aggregateId: aggregate.aggregateId,
        aggregateType: aggregate.aggregateType,
        seq: 1,
        updatedAt: now
      },
      update: {
        aggregateType: aggregate.aggregateType,
        seq: {
          increment: 1
        },
        updatedAt: now
      }
    })

    return tx.agentEvent.create({
      data: {
        aggregateId: aggregate.aggregateId,
        aggregateType: aggregate.aggregateType,
        checkpointId: input.checkpointId ?? null,
        createdAt: now,
        eventId: input.eventId ?? randomUUID(),
        metadata,
        payload,
        runId: input.runId ?? null,
        schemaVersion: input.schemaVersion ?? 1,
        seq: sequence.seq,
        threadId: input.threadId,
        traceId: input.traceId ?? (input.runId ? input.runId : null),
        type: input.type
      }
    })
  })

  if (input.runId) {
    if (input.projectTrace === true) {
      enqueueAgentTraceProjection(input.runId)
    } else if (input.projectTrace !== false) {
      markAgentTraceProjectionDirty(input.runId)
    }
  }

  return mapAgentEventRow(row)
}

export async function appendAgentEventSafely(
  input: AppendAgentEventInput
): Promise<AgentEventRow | null> {
  try {
    return await appendAgentEvent(input)
  } catch (error) {
    console.warn(
      `[AgentEventRecorder] Failed to append ${input.type} for thread ${input.threadId}:`,
      error
    )
    return null
  }
}

export class AgentEventRecorder {
  async appendEvent(input: AppendAgentEventInput): Promise<AgentEventRow> {
    return appendAgentEvent(input)
  }

  async appendEventSafely(input: AppendAgentEventInput): Promise<AgentEventRow | null> {
    return appendAgentEventSafely(input)
  }
}
