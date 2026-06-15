import { createHash } from "crypto"
import { getPrismaClient } from "./client"
import { toNumber } from "./utils"
import { parseAgentEventPayloadFromJson } from "../agent-events/schema"

type TraceStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "waiting_for_human"
  | "canceled"
type StepStatus = "running" | "completed" | "failed" | "waiting_for_human"
type StepType = "approval" | "call_llm" | "call_tool"
type BlobKind =
  | "context_snapshot"
  | "llm_input"
  | "llm_output"
  | "messages_baseline"
  | "messages_delta"
  | "raw"
  | "tool_input"
  | "tool_output"
  | "tool_schema"

interface AgentEventForProjection {
  aggregateId: string
  aggregateType: string
  checkpointId: string | null
  createdAt: bigint
  eventId: string
  metadata: string | null
  payload: string
  runId: string | null
  seq: number
  threadId: string
  traceId: string | null
  type: string
}

interface StepDraft {
  completedAt: number | null
  contextBlobId: string | null
  cost: number
  durationMs: number | null
  errorMessage: string | null
  errorType: string | null
  eventSeq: number | null
  eventType: string | null
  inputBlobId: string | null
  inputTokens: number
  messagesBaselineBlobId: string | null
  messagesDeltaBlobId: string | null
  model: string | null
  outputBlobId: string | null
  outputTokens: number
  projectedThroughSeq: number
  provider: string | null
  startedAt: number
  status: StepStatus
  stepIndex: number
  stepType: StepType
  toolCallId: string | null
  toolName: string | null
  totalTokens: number
}

interface BlobDraft {
  blobId: string
  contentType: string
  createdAt: bigint
  encoding: string
  kind: BlobKind
  preview: string | null
  runId: string | null
  sha256: string
  sizeBytes: number
  stepIndex: number | null
  threadId: string
  traceId: string
  value: string
}

export interface AgentTraceSummaryRow {
  completed_at: number | null
  completion_reason: string | null
  error_message: string | null
  error_type: string | null
  has_gap: boolean
  model: string | null
  projected_through_seq: number
  provider: string | null
  run_id: string
  started_at: number
  status: string
  thread_id: string
  total_input_tokens: number
  total_output_tokens: number
  total_steps: number
  total_tokens: number
  trace_id: string
}

export interface AgentTraceStepRow {
  completed_at: number | null
  duration_ms: number | null
  error_message: string | null
  error_type: string | null
  input_blob_id: string | null
  input_tokens: number
  messages_baseline_blob_id: string | null
  messages_delta_blob_id: string | null
  model: string | null
  output_blob_id: string | null
  output_tokens: number
  provider: string | null
  started_at: number
  status: string
  step_index: number
  step_type: string
  tool_call_id: string | null
  tool_name: string | null
  total_tokens: number
}

export interface AgentTraceBlobRow {
  blob_id: string
  kind: string
  preview: string | null
  size_bytes: number
  value: string
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readTimestamp(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function serializeBlobValue(value: unknown): {
  contentType: string
  encoding: string
  value: string
} {
  if (typeof value === "string") {
    return {
      contentType: "text/plain",
      encoding: "text",
      value
    }
  }

  return {
    contentType: "application/json",
    encoding: "json",
    value: JSON.stringify(value)
  }
}

function createBlobDraft(input: {
  event: AgentEventForProjection
  kind: BlobKind
  stepIndex: number | null
  traceId: string
  value: unknown
}): BlobDraft {
  const serialized = serializeBlobValue(input.value)
  const sha256 = createHash("sha256").update(serialized.value).digest("hex")
  const preview = compactText(serialized.value).slice(0, 240)

  return {
    blobId: `${input.traceId}:${input.event.seq}:${input.kind}:${sha256.slice(0, 16)}`,
    contentType: serialized.contentType,
    createdAt: input.event.createdAt,
    encoding: serialized.encoding,
    kind: input.kind,
    preview: preview.length > 0 ? preview : null,
    runId: input.event.runId,
    sha256,
    sizeBytes: Buffer.byteLength(serialized.value, "utf8"),
    stepIndex: input.stepIndex,
    threadId: input.event.threadId,
    traceId: input.traceId,
    value: serialized.value
  }
}

function classifyStepType(type: string): StepType | null {
  if (type.startsWith("llm.")) {
    return "call_llm"
  }

  if (type.startsWith("tool.call.")) {
    return "call_tool"
  }

  if (type.startsWith("approval.")) {
    return "approval"
  }

  return null
}

function classifyStepStatus(type: string): StepStatus {
  if (type.endsWith(".failed")) {
    return "failed"
  }

  if (type === "approval.requested") {
    return "waiting_for_human"
  }

  if (type.endsWith(".started") || type === "llm.input.captured") {
    return "running"
  }

  return "completed"
}

function classifyEventStepStatus(type: string, payload: Record<string, unknown>): StepStatus {
  if (readString(payload, "errorMessage")) {
    return "failed"
  }

  return classifyStepStatus(type)
}

function readStepKey(
  event: AgentEventForProjection,
  payload: Record<string, unknown>,
  stepType: StepType
): string {
  const explicitStepId = readString(payload, "stepId")
  if (explicitStepId) {
    return `${stepType}:${explicitStepId}`
  }

  if (stepType === "call_tool") {
    const toolCallId = readString(payload, "toolCallId")
    return toolCallId ? `tool:${toolCallId}` : `event:${event.seq}`
  }

  if (stepType === "approval") {
    const requestId = readString(payload, "requestId")
    const toolCallId = readString(payload, "toolCallId")
    return requestId
      ? `approval:${requestId}`
      : toolCallId
        ? `approval-tool:${toolCallId}`
        : `event:${event.seq}`
  }

  if (stepType === "call_llm") {
    const messageId = readString(payload, "messageId")
    const llmRunId = readString(payload, "llmRunId")
    return messageId
      ? `llm-message:${messageId}`
      : llmRunId
        ? `llm-run:${llmRunId}`
        : `event:${event.seq}`
  }

  return `event:${event.seq}`
}

function readTraceStatusFromRunFinished(payload: Record<string, unknown>): TraceStatus {
  const status = readString(payload, "status")
  if (status === "success" || status === "completed") {
    return "completed"
  }

  if (status === "error" || status === "failed") {
    return "failed"
  }

  if (status === "cancelled" || status === "canceled") {
    return "canceled"
  }

  if (status === "interrupted") {
    return "interrupted"
  }

  return "completed"
}

function updateStepFromPayload(
  step: StepDraft,
  event: AgentEventForProjection,
  payload: Record<string, unknown>,
  status: StepStatus
): void {
  const startedAt = readTimestamp(payload, "startedAt")
  const completedAt = readTimestamp(payload, "completedAt")
  step.startedAt = Math.min(step.startedAt, startedAt ?? toNumber(event.createdAt))
  step.completedAt =
    completedAt ?? (status === "running" ? step.completedAt : toNumber(event.createdAt))
  step.status = status === "running" && step.status !== "running" ? step.status : status
  step.model = readString(payload, "model") ?? step.model
  step.provider = readString(payload, "provider") ?? step.provider
  step.inputTokens = readNumber(payload, "inputTokens") ?? step.inputTokens
  step.outputTokens = readNumber(payload, "outputTokens") ?? step.outputTokens
  step.totalTokens = readNumber(payload, "totalTokens") ?? step.totalTokens
  step.cost = readNumber(payload, "cost") ?? step.cost
  step.toolName = readString(payload, "toolName") ?? step.toolName
  step.toolCallId = readString(payload, "toolCallId") ?? step.toolCallId
  step.errorType = readString(payload, "errorType") ?? step.errorType
  step.errorMessage = readString(payload, "errorMessage") ?? step.errorMessage
  step.eventType = event.type
  step.eventSeq = event.seq
  step.projectedThroughSeq = event.seq

  const explicitDuration = readNumber(payload, "durationMs")
  step.durationMs =
    explicitDuration ??
    (step.completedAt !== null ? Math.max(0, step.completedAt - step.startedAt) : step.durationMs)
}

function attachBlob(
  input: {
    blobs: BlobDraft[]
    event: AgentEventForProjection
    kind: BlobKind
    payload: Record<string, unknown>
    step: StepDraft
    traceId: string
  },
  keys: string[]
): string | null {
  const key = keys.find((candidate) =>
    Object.prototype.hasOwnProperty.call(input.payload, candidate)
  )
  if (!key) {
    return null
  }

  const blob = createBlobDraft({
    event: input.event,
    kind: input.kind,
    stepIndex: input.step.stepIndex,
    traceId: input.traceId,
    value: input.payload[key]
  })
  input.blobs.push(blob)
  return blob.blobId
}

function attachStepBlobs(input: {
  blobs: BlobDraft[]
  event: AgentEventForProjection
  payload: Record<string, unknown>
  step: StepDraft
  traceId: string
}): void {
  const { step } = input
  step.messagesBaselineBlobId =
    attachBlob({ ...input, kind: "messages_baseline" }, ["messagesBaseline"]) ??
    step.messagesBaselineBlobId
  step.messagesDeltaBlobId =
    attachBlob({ ...input, kind: "messages_delta" }, ["messagesDelta"]) ??
    step.messagesDeltaBlobId
  step.contextBlobId =
    attachBlob({ ...input, kind: "context_snapshot" }, ["context", "contextSnapshot"]) ??
    step.contextBlobId

  if (step.stepType === "call_tool") {
    step.inputBlobId =
      attachBlob({ ...input, kind: "tool_input" }, ["input", "args", "toolInput"]) ??
      step.inputBlobId
    step.outputBlobId =
      attachBlob({ ...input, kind: "tool_output" }, ["output", "result", "toolOutput"]) ??
      step.outputBlobId
    return
  }

  if (step.stepType === "call_llm") {
    step.inputBlobId =
      attachBlob({ ...input, kind: "llm_input" }, ["input", "llmInput"]) ??
      step.inputBlobId
    step.outputBlobId =
      attachBlob({ ...input, kind: "llm_output" }, ["output", "llmOutput"]) ??
      step.outputBlobId
    attachBlob({ ...input, kind: "tool_schema" }, ["toolSchema"])
  }
}

function hasSeqGap(events: AgentEventForProjection[]): boolean {
  let expected = 1
  for (const event of events) {
    if (event.seq !== expected) {
      return true
    }
    expected += 1
  }
  return false
}

function mapTraceRow(row: {
  completedAt: bigint | null
  completionReason: string | null
  errorMessage: string | null
  errorType: string | null
  hasGap: boolean
  model: string | null
  projectedThroughSeq: number
  provider: string | null
  runId: string
  startedAt: bigint
  status: string
  threadId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalSteps: number
  totalTokens: number
  traceId: string
}): AgentTraceSummaryRow {
  return {
    completed_at: row.completedAt === null ? null : toNumber(row.completedAt),
    completion_reason: row.completionReason,
    error_message: row.errorMessage,
    error_type: row.errorType,
    has_gap: row.hasGap,
    model: row.model,
    projected_through_seq: row.projectedThroughSeq,
    provider: row.provider,
    run_id: row.runId,
    started_at: toNumber(row.startedAt),
    status: row.status,
    thread_id: row.threadId,
    total_input_tokens: row.totalInputTokens,
    total_output_tokens: row.totalOutputTokens,
    total_steps: row.totalSteps,
    total_tokens: row.totalTokens,
    trace_id: row.traceId
  }
}

function mapStepRow(row: {
  completedAt: bigint | null
  durationMs: number | null
  errorMessage: string | null
  errorType: string | null
  inputBlobId: string | null
  inputTokens: number
  messagesBaselineBlobId: string | null
  messagesDeltaBlobId: string | null
  model: string | null
  outputBlobId: string | null
  outputTokens: number
  provider: string | null
  startedAt: bigint
  status: string
  stepIndex: number
  stepType: string
  toolCallId: string | null
  toolName: string | null
  totalTokens: number
}): AgentTraceStepRow {
  return {
    completed_at: row.completedAt === null ? null : toNumber(row.completedAt),
    duration_ms: row.durationMs,
    error_message: row.errorMessage,
    error_type: row.errorType,
    input_blob_id: row.inputBlobId,
    input_tokens: row.inputTokens,
    messages_baseline_blob_id: row.messagesBaselineBlobId,
    messages_delta_blob_id: row.messagesDeltaBlobId,
    model: row.model,
    output_blob_id: row.outputBlobId,
    output_tokens: row.outputTokens,
    provider: row.provider,
    started_at: toNumber(row.startedAt),
    status: row.status,
    step_index: row.stepIndex,
    step_type: row.stepType,
    tool_call_id: row.toolCallId,
    tool_name: row.toolName,
    total_tokens: row.totalTokens
  }
}

export async function markAgentTraceProjectionError(runId: string, message: string): Promise<void> {
  const prisma = getPrismaClient()
  const existing = await prisma.agentTrace.findUnique({
    where: {
      runId
    }
  })

  if (!existing) {
    return
  }

  await prisma.agentTrace.update({
    where: {
      traceId: existing.traceId
    },
    data: {
      projectionError: message,
      updatedAt: BigInt(Date.now())
    }
  })
}

export async function projectAgentTraceForRun(runId: string): Promise<AgentTraceSummaryRow | null> {
  const prisma = getPrismaClient()
  const events = await prisma.agentEvent.findMany({
    where: {
      aggregateType: "run",
      runId
    },
    orderBy: {
      seq: "asc"
    }
  })

  if (events.length === 0) {
    return null
  }

  const firstEvent = events[0]!
  const traceId = firstEvent.traceId ?? runId
  const threadId = firstEvent.threadId
  const steps: StepDraft[] = []
  const stepByKey = new Map<string, StepDraft>()
  const blobs: BlobDraft[] = []
  let traceStatus: TraceStatus = "running"
  let completedAt: number | null = null
  let completionReason: string | null = null
  let errorType: string | null = null
  let errorMessage: string | null = null
  let model: string | null = null
  let provider: string | null = null
  let projectedThroughSeq = 0

  for (const event of events) {
    const payload = parseAgentEventPayloadFromJson(event.type, event.payload)
    projectedThroughSeq = Math.max(projectedThroughSeq, event.seq)

    model = readString(payload, "model") ?? model
    provider = readString(payload, "provider") ?? provider

    if (event.type === "run.started" || event.type === "run.resumed") {
      traceStatus = "running"
    }

    if (event.type === "approval.requested") {
      traceStatus = "waiting_for_human"
    }

    if (event.type === "approval.resolved") {
      traceStatus = "running"
    }

    if (event.type === "run.interrupted") {
      traceStatus = "interrupted"
    }

    if (event.type === "run.finished") {
      traceStatus = readTraceStatusFromRunFinished(payload)
      completedAt = readTimestamp(payload, "completedAt") ?? toNumber(event.createdAt)
      completionReason = readString(payload, "completionReason")
      errorType = readString(payload, "errorType")
      errorMessage = readString(payload, "errorMessage")
    }

    const stepType = classifyStepType(event.type)
    if (!stepType) {
      continue
    }

    const key = readStepKey(event, payload, stepType)
    let step = stepByKey.get(key)
    if (!step) {
      step = {
        completedAt: null,
        contextBlobId: null,
        cost: 0,
        durationMs: null,
        errorMessage: null,
        errorType: null,
        eventSeq: null,
        eventType: null,
        inputBlobId: null,
        inputTokens: 0,
        messagesBaselineBlobId: null,
        messagesDeltaBlobId: null,
        model: null,
        outputBlobId: null,
        outputTokens: 0,
        projectedThroughSeq: event.seq,
        provider: null,
        startedAt: readTimestamp(payload, "startedAt") ?? toNumber(event.createdAt),
        status: classifyEventStepStatus(event.type, payload),
        stepIndex: steps.length,
        stepType,
        toolCallId: null,
        toolName: null,
        totalTokens: 0
      }
      stepByKey.set(key, step)
      steps.push(step)
    }

    updateStepFromPayload(step, event, payload, classifyEventStepStatus(event.type, payload))
    attachStepBlobs({
      blobs,
      event,
      payload,
      step,
      traceId
    })
  }

  const totalInputTokens = steps.reduce((total, step) => total + step.inputTokens, 0)
  const totalOutputTokens = steps.reduce((total, step) => total + step.outputTokens, 0)
  const totalTokens = steps.reduce((total, step) => total + step.totalTokens, 0)
  const totalCost = steps.reduce((total, step) => total + step.cost, 0)
  const now = BigInt(Date.now())
  const startedAt = toNumber(firstEvent.createdAt)
  const hasGap = hasSeqGap(events)

  const trace = await prisma.$transaction(async (tx) => {
    await tx.agentTrace.upsert({
      where: {
        traceId
      },
      create: {
        completedAt: completedAt === null ? null : BigInt(completedAt),
        completionReason,
        createdAt: now,
        errorMessage,
        errorType,
        hasGap,
        model,
        projectedThroughSeq,
        provider,
        runId,
        startedAt: BigInt(startedAt),
        status: traceStatus,
        threadId,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalSteps: steps.length,
        totalTokens,
        traceId,
        updatedAt: now
      },
      update: {
        completedAt: completedAt === null ? null : BigInt(completedAt),
        completionReason,
        errorMessage,
        errorType,
        hasGap,
        model,
        projectedThroughSeq,
        projectionError: null,
        provider,
        status: traceStatus,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalSteps: steps.length,
        totalTokens,
        updatedAt: now
      }
    })

    await tx.agentTraceBlob.deleteMany({
      where: {
        traceId
      }
    })
    await tx.agentTraceStep.deleteMany({
      where: {
        traceId
      }
    })

    if (blobs.length > 0) {
      await tx.agentTraceBlob.createMany({
        data: blobs
      })
    }

    if (steps.length > 0) {
      await tx.agentTraceStep.createMany({
        data: steps.map((step) => ({
          completedAt: step.completedAt === null ? null : BigInt(step.completedAt),
          contextBlobId: step.contextBlobId,
          cost: step.cost,
          durationMs: step.durationMs,
          errorMessage: step.errorMessage,
          errorType: step.errorType,
          eventSeq: step.eventSeq,
          eventType: step.eventType,
          inputBlobId: step.inputBlobId,
          inputTokens: step.inputTokens,
          messagesBaselineBlobId: step.messagesBaselineBlobId,
          messagesDeltaBlobId: step.messagesDeltaBlobId,
          model: step.model,
          outputBlobId: step.outputBlobId,
          outputTokens: step.outputTokens,
          projectedThroughSeq: step.projectedThroughSeq,
          provider: step.provider,
          startedAt: BigInt(step.startedAt),
          status: step.status,
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          toolCallId: step.toolCallId,
          toolName: step.toolName,
          totalTokens: step.totalTokens,
          traceId
        }))
      })
    }

    return tx.agentTrace.findUniqueOrThrow({
      where: {
        traceId
      }
    })
  })

  return mapTraceRow(trace)
}

export async function listAgentTraces(limit = 20): Promise<AgentTraceSummaryRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentTrace.findMany({
    orderBy: {
      startedAt: "desc"
    },
    take: limit
  })

  return rows.map(mapTraceRow)
}

export async function getAgentTrace(traceIdOrLatest: string): Promise<AgentTraceSummaryRow | null> {
  const prisma = getPrismaClient()
  const row =
    traceIdOrLatest === "latest"
      ? await prisma.agentTrace.findFirst({
          orderBy: {
            startedAt: "desc"
          }
        })
      : await prisma.agentTrace.findUnique({
          where: {
            traceId: traceIdOrLatest
          }
        })

  return row ? mapTraceRow(row) : null
}

export async function getAgentTraceSteps(traceId: string): Promise<AgentTraceStepRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentTraceStep.findMany({
    where: {
      traceId
    },
    orderBy: {
      stepIndex: "asc"
    }
  })

  return rows.map(mapStepRow)
}

export async function getAgentTraceStep(
  traceId: string,
  stepIndex: number
): Promise<AgentTraceStepRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.agentTraceStep.findUnique({
    where: {
      traceId_stepIndex: {
        stepIndex,
        traceId
      }
    }
  })

  return row ? mapStepRow(row) : null
}

export async function getAgentTraceEvents(traceId: string): Promise<
  Array<{
    created_at: number
    event_id: string
    payload: string
    seq: number
    type: string
  }>
> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentEvent.findMany({
    where: {
      traceId
    },
    orderBy: {
      seq: "asc"
    }
  })

  return rows.map((row) => ({
    created_at: toNumber(row.createdAt),
    event_id: row.eventId,
    payload: row.payload,
    seq: row.seq,
    type: row.type
  }))
}

export async function getAgentTraceBlob(blobId: string | null): Promise<AgentTraceBlobRow | null> {
  if (!blobId) {
    return null
  }

  const prisma = getPrismaClient()
  const row = await prisma.agentTraceBlob.findUnique({
    where: {
      blobId
    }
  })

  return row
    ? {
        blob_id: row.blobId,
        kind: row.kind,
        preview: row.preview,
        size_bytes: row.sizeBytes,
        value: row.value
      }
    : null
}

export async function rebuildTraceStepMessages(
  traceId: string,
  stepIndex: number
): Promise<unknown[]> {
  const step = await getAgentTraceStep(traceId, stepIndex)
  if (!step) {
    throw new Error(
      `[AgentTraceProjector] Trace step ${stepIndex} not found for trace "${traceId}".`
    )
  }

  const baselineBlob = await getAgentTraceBlob(step.messages_baseline_blob_id)
  if (!baselineBlob) {
    return []
  }

  const baseline = JSON.parse(baselineBlob.value) as unknown
  if (!Array.isArray(baseline)) {
    throw new Error("[AgentTraceProjector] messages baseline blob must be an array.")
  }

  const deltaBlob = await getAgentTraceBlob(step.messages_delta_blob_id)
  if (!deltaBlob) {
    return baseline
  }

  const delta = JSON.parse(deltaBlob.value) as unknown
  if (Array.isArray(delta)) {
    return [...baseline, ...delta]
  }

  if (delta && typeof delta === "object" && Array.isArray((delta as { append?: unknown }).append)) {
    return [...baseline, ...(delta as { append: unknown[] }).append]
  }

  throw new Error("[AgentTraceProjector] Unsupported messages delta format.")
}
