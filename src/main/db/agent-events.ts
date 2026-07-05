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

interface PreparedAgentEventInput {
  aggregateId: string
  aggregateType: AgentEventAggregateType
  checkpointId: string | null
  createdAt: bigint
  eventId: string
  metadata: string | null
  payload: string
  runId: string | null
  schemaVersion: number
  threadId: string
  traceId: string | null
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

function prepareAgentEventInput(input: AppendAgentEventInput, now: bigint): PreparedAgentEventInput {
  const aggregate = resolveAggregate(input)
  const payload = serializeJsonValue(normalizeAgentEventPayload(input.type, input.payload)) ?? "{}"
  const metadata = serializeJsonValue(input.metadata) ?? null

  return {
    aggregateId: aggregate.aggregateId,
    aggregateType: aggregate.aggregateType,
    checkpointId: input.checkpointId ?? null,
    createdAt: now,
    eventId: input.eventId ?? randomUUID(),
    metadata,
    payload,
    runId: input.runId ?? null,
    schemaVersion: input.schemaVersion ?? 1,
    threadId: input.threadId,
    traceId: input.traceId ?? (input.runId ? input.runId : null),
    type: input.type
  }
}

function updateTraceProjectionState(inputs: readonly AppendAgentEventInput[]): void {
  const requestedProjectionByRunId = new Map<string, "dirty" | "enqueue">()
  for (const input of inputs) {
    if (!input.runId) {
      continue
    }

    if (input.projectTrace === true) {
      requestedProjectionByRunId.set(input.runId, "enqueue")
    } else if (
      input.projectTrace !== false &&
      requestedProjectionByRunId.get(input.runId) !== "enqueue"
    ) {
      requestedProjectionByRunId.set(input.runId, "dirty")
    }
  }

  for (const [runId, request] of requestedProjectionByRunId) {
    if (request === "enqueue") {
      enqueueAgentTraceProjection(runId)
    } else {
      markAgentTraceProjectionDirty(runId)
    }
  }
}

export async function appendAgentEvent(input: AppendAgentEventInput): Promise<AgentEventRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const prepared = prepareAgentEventInput(input, now)

  const row = await prisma.$transaction(async (tx) => {
    const sequence = await tx.agentEventSequence.upsert({
      where: {
        aggregateId: prepared.aggregateId
      },
      create: {
        aggregateId: prepared.aggregateId,
        aggregateType: prepared.aggregateType,
        seq: 1,
        updatedAt: now
      },
      update: {
        aggregateType: prepared.aggregateType,
        seq: {
          increment: 1
        },
        updatedAt: now
      }
    })

    return tx.agentEvent.create({
      data: {
        aggregateId: prepared.aggregateId,
        aggregateType: prepared.aggregateType,
        checkpointId: prepared.checkpointId,
        createdAt: prepared.createdAt,
        eventId: prepared.eventId,
        metadata: prepared.metadata,
        payload: prepared.payload,
        runId: prepared.runId,
        schemaVersion: prepared.schemaVersion,
        seq: sequence.seq,
        threadId: prepared.threadId,
        traceId: prepared.traceId,
        type: prepared.type
      }
    })
  })

  updateTraceProjectionState([input])

  return mapAgentEventRow(row)
}

export async function appendAgentEvents(
  inputs: readonly AppendAgentEventInput[]
): Promise<AgentEventRow[]> {
  if (inputs.length === 0) {
    return []
  }

  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const prepared = inputs.map((input) => prepareAgentEventInput(input, now))
  const [firstEvent] = prepared
  for (const event of prepared) {
    if (
      event.aggregateId !== firstEvent.aggregateId ||
      event.aggregateType !== firstEvent.aggregateType
    ) {
      throw new Error("[AgentEventRecorder] appendAgentEvents requires one aggregate per batch.")
    }
  }

  const rows = await prisma.$transaction(async (tx) => {
    const sequence = await tx.agentEventSequence.upsert({
      where: {
        aggregateId: firstEvent.aggregateId
      },
      create: {
        aggregateId: firstEvent.aggregateId,
        aggregateType: firstEvent.aggregateType,
        seq: prepared.length,
        updatedAt: now
      },
      update: {
        aggregateType: firstEvent.aggregateType,
        seq: {
          increment: prepared.length
        },
        updatedAt: now
      }
    })
    const firstSeq = sequence.seq - prepared.length + 1
    const rowsToCreate = prepared.map((event, index) => ({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      checkpointId: event.checkpointId,
      createdAt: event.createdAt,
      eventId: event.eventId,
      metadata: event.metadata,
      payload: event.payload,
      runId: event.runId,
      schemaVersion: event.schemaVersion,
      seq: firstSeq + index,
      threadId: event.threadId,
      traceId: event.traceId,
      type: event.type
    }))

    await tx.agentEvent.createMany({ data: rowsToCreate })
    return rowsToCreate
  })

  updateTraceProjectionState(inputs)
  return rows.map(mapAgentEventRow)
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

export async function appendAgentEventsSafely(
  inputs: readonly AppendAgentEventInput[]
): Promise<AgentEventRow[]> {
  try {
    return await appendAgentEvents(inputs)
  } catch (error) {
    console.warn("[AgentEventRecorder] Failed to append agent event batch:", error)
    return []
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
