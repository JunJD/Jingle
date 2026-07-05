export const JINGLE_TOOL_EXECUTION_METADATA_KEY = "jingleToolExecution"

export type JingleToolExecutionStatus = "running" | "completed" | "failed"

export interface JingleToolExecutionError {
  message: string
  type?: string
}

export interface JingleToolExecutionTiming {
  completedAt?: Date
  durationMs?: number
  error?: JingleToolExecutionError
  messageId: string | null
  runId: string | null
  startedAt?: Date
  status: JingleToolExecutionStatus
  toolCallId: string
  toolName: string | null
}

export interface JingleToolExecutionMetadataSource {
  metadata?: Record<string, unknown> | null
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function toJingleToolExecutionStatus(value: unknown): JingleToolExecutionStatus | null {
  return value === "running" || value === "completed" || value === "failed" ? value : null
}

function toJingleToolExecutionError(value: unknown): JingleToolExecutionError | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const message = (value as { message?: unknown }).message
  if (typeof message !== "string" || !message.trim()) {
    return undefined
  }

  const type = (value as { type?: unknown }).type
  return {
    message,
    ...(typeof type === "string" && type.trim() ? { type } : {})
  }
}

export function readJingleToolExecutionTiming(
  source: JingleToolExecutionMetadataSource
): JingleToolExecutionTiming | null {
  const metadataValue = source.metadata?.[JINGLE_TOOL_EXECUTION_METADATA_KEY]
  if (!metadataValue || typeof metadataValue !== "object") {
    return null
  }

  const value = metadataValue as Record<string, unknown>
  const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : null
  const status = toJingleToolExecutionStatus(value.status)
  const startedAt = toDate(value.startedAt)
  if (!toolCallId || !status) {
    return null
  }

  const completedAt = toDate(value.completedAt)
  const durationMs = toFiniteNumber(value.durationMs)
  const messageId = typeof value.messageId === "string" ? value.messageId : null
  const runId = typeof value.runId === "string" ? value.runId : null
  const toolName = typeof value.toolName === "string" ? value.toolName : null
  const error = toJingleToolExecutionError(value.error)

  return {
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {}),
    messageId,
    runId,
    ...(startedAt ? { startedAt } : {}),
    status,
    toolCallId,
    toolName
  }
}
