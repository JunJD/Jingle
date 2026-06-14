import { randomUUID } from "crypto"
import { getPrismaClient } from "./client"
import { markAgentTraceProjectionError, projectAgentTraceForRun } from "./agent-traces"
import { serializeJsonValue, toNumber } from "./utils"
import { normalizeAgentEventPayload, type AgentEventType } from "../agent-events/schema"

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

interface AgentTraceProjectionQueueState {
  dirtyRunIds: Set<string>
  drainQueued: boolean
  flushRequested: boolean
  queue: Promise<void>
  scheduledRunIds: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

const AGENT_TRACE_PROJECTION_QUEUE_STATE_KEY = "__openworkAgentTraceProjectionQueueState__"
const AGENT_TRACE_PROJECTION_DEBOUNCE_MS = 500

function getAgentTraceProjectionQueueState(): AgentTraceProjectionQueueState {
  const globalScope = globalThis as typeof globalThis & {
    [AGENT_TRACE_PROJECTION_QUEUE_STATE_KEY]?: AgentTraceProjectionQueueState
  }

  let state = globalScope[AGENT_TRACE_PROJECTION_QUEUE_STATE_KEY]
  if (!state) {
    state = {
      dirtyRunIds: new Set<string>(),
      drainQueued: false,
      flushRequested: false,
      queue: Promise.resolve(),
      scheduledRunIds: new Set<string>(),
      timer: null
    }
    globalScope[AGENT_TRACE_PROJECTION_QUEUE_STATE_KEY] = state
  }

  return state
}

async function projectAgentTraceForRunSafely(runId: string): Promise<void> {
  try {
    await projectAgentTraceForRun(runId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[AgentTraceProjector] Failed to project trace for run ${runId}:`, error)
    try {
      await markAgentTraceProjectionError(runId, message)
    } catch (markError) {
      console.warn(
        `[AgentTraceProjector] Failed to mark projection error for run ${runId}:`,
        markError
      )
    }
  }
}

async function drainPendingAgentTraceProjections(
  state: AgentTraceProjectionQueueState
): Promise<void> {
  const runIds = state.flushRequested
    ? Array.from(state.dirtyRunIds)
    : Array.from(state.scheduledRunIds)
  state.flushRequested = false

  for (const runId of runIds) {
    state.dirtyRunIds.delete(runId)
    state.scheduledRunIds.delete(runId)
  }

  for (const runId of runIds) {
    await projectAgentTraceForRunSafely(runId)
  }
}

function queueAgentTraceProjectionDrain(
  state: AgentTraceProjectionQueueState,
  options: { flush: boolean }
): void {
  if (options.flush) {
    state.flushRequested = true
  }

  if (state.drainQueued) {
    return
  }

  state.drainQueued = true
  state.queue = state.queue
    .catch(() => undefined)
    .then(async () => {
      try {
        await drainPendingAgentTraceProjections(state)
      } finally {
        state.drainQueued = false
        if (state.scheduledRunIds.size > 0) {
          scheduleAgentTraceProjectionDrain(state)
        }
      }
    })
}

function scheduleAgentTraceProjectionDrain(state: AgentTraceProjectionQueueState): void {
  if (state.timer || state.drainQueued) {
    return
  }

  state.timer = setTimeout(() => {
    state.timer = null
    queueAgentTraceProjectionDrain(state, { flush: false })
  }, AGENT_TRACE_PROJECTION_DEBOUNCE_MS)
  state.timer.unref?.()
}

export function enqueueAgentTraceProjection(runId: string): void {
  const state = getAgentTraceProjectionQueueState()
  state.dirtyRunIds.add(runId)
  state.scheduledRunIds.add(runId)
  scheduleAgentTraceProjectionDrain(state)
}

function markAgentTraceProjectionDirty(runId: string): void {
  const state = getAgentTraceProjectionQueueState()
  state.dirtyRunIds.add(runId)
}

export async function flushAgentTraceProjection(): Promise<void> {
  const state = getAgentTraceProjectionQueueState()

  for (;;) {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
      queueAgentTraceProjectionDrain(state, { flush: true })
    } else if (
      (state.dirtyRunIds.size > 0 || state.scheduledRunIds.size > 0) &&
      !state.drainQueued
    ) {
      queueAgentTraceProjectionDrain(state, { flush: true })
    }

    await state.queue

    if (
      !state.timer &&
      !state.drainQueued &&
      state.dirtyRunIds.size === 0 &&
      state.scheduledRunIds.size === 0
    ) {
      return
    }
  }
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
