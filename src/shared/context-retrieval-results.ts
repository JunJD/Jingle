export type ContextRetrievalResultStatus = "empty" | "ok" | "unavailable"

export interface ContextRetrievalNextAction {
  args: Record<string, unknown>
  reason: string
  tool: "get_message_context" | "get_trace_evidence" | "search_history"
}

export interface RetrievedThreadDigestResultItem {
  messageCount: number
  summary: string
  threadId: string
  title: string | null
  type: "thread_digest"
}

export interface RetrievedHistoryMessageResultItem {
  messageId: string
  role: string
  runId: string | null
  snippet: string
  threadId: string
  title?: string | null
  toolCallId: string | null
  toolCalls: Array<{ id: string; name: string }>
  type: "history_message"
}

export interface SearchHistoryToolResult {
  diagnostics?: string[]
  items: Array<RetrievedThreadDigestResultItem | RetrievedHistoryMessageResultItem>
  kind: "history_search"
  nextActions: ContextRetrievalNextAction[]
  query: string
  summary: string
  status: ContextRetrievalResultStatus
}

export interface MessageContextResultItem {
  messageId: string
  role: string
  runId: string | null
  text: string
  threadId: string
  toolCallId: string | null
  toolCalls: Array<{ id: string; name: string }>
}

export interface MessageContextToolResult {
  diagnostics?: string[]
  focus: {
    messageId: string
    runId: string | null
    threadId: string
  }
  items: MessageContextResultItem[]
  kind: "message_context"
  nextActions: ContextRetrievalNextAction[]
  summary: string
  status: ContextRetrievalResultStatus
  window: {
    after: number
    before: number
  }
}

export interface TraceBlobResult {
  kind: string
  preview: string | null
  sizeBytes: number
  text: string
}

export interface TraceArtifactResultItem {
  artifactId: string
  kind: string
  preview: string | null
  runId: string | null
  status: string
  threadId: string
  title: string
  toolCallId: string | null
}

export interface TraceEvidenceToolResult {
  artifacts: TraceArtifactResultItem[]
  blobs: {
    input: TraceBlobResult | null
    output: TraceBlobResult | null
  }
  diagnostics?: string[]
  kind: "trace_evidence"
  nextActions: ContextRetrievalNextAction[]
  status: ContextRetrievalResultStatus
  step: {
    durationMs: number | null
    status: string
    stepIndex: number
    stepType: string
    toolCallId: string | null
    toolName: string | null
    traceStepId: string
  } | null
  summary: string
  trace: {
    model: string | null
    provider: string | null
    runId: string | null
    status: string | null
    threadId: string | null
    traceId: string | null
  }
}

export type ContextRetrievalToolResult =
  | MessageContextToolResult
  | SearchHistoryToolResult
  | TraceEvidenceToolResult

export function serializeContextRetrievalToolResult(result: ContextRetrievalToolResult): string {
  return JSON.stringify(result, null, 2)
}

export function parseContextRetrievalToolResult(value: unknown): ContextRetrievalToolResult | null {
  const parsed = typeof value === "string" ? parseJson(value) : value
  if (!isRecord(parsed) || typeof parsed.kind !== "string") {
    return null
  }

  switch (parsed.kind) {
    case "history_search":
      return isSearchHistoryToolResult(parsed) ? parsed : null
    case "message_context":
      return isMessageContextToolResult(parsed) ? parsed : null
    case "trace_evidence":
      return isTraceEvidenceToolResult(parsed) ? parsed : null
    default:
      return null
  }
}

function parseJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) {
    return null
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isStatus(value: unknown): value is ContextRetrievalResultStatus {
  return value === "empty" || value === "ok" || value === "unavailable"
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isOptionalDiagnostics(value: unknown): value is string[] | undefined {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
  )
}

function isToolCalls(value: unknown): value is Array<{ id: string; name: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isRecord(item) && typeof item.id === "string" && typeof item.name === "string"
    )
  )
}

function isNextActions(value: unknown): value is ContextRetrievalNextAction[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        isRecord(item.args) &&
        typeof item.reason === "string" &&
        (item.tool === "get_message_context" ||
          item.tool === "get_trace_evidence" ||
          item.tool === "search_history")
    )
  )
}

function isSearchHistoryToolResult(value: unknown): value is SearchHistoryToolResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.kind === "history_search" &&
    isStatus(value.status) &&
    typeof value.query === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isHistorySearchResultItem) &&
    isOptionalDiagnostics(value.diagnostics) &&
    isNextActions(value.nextActions)
  )
}

function isHistorySearchResultItem(
  value: unknown
): value is RetrievedThreadDigestResultItem | RetrievedHistoryMessageResultItem {
  if (!isRecord(value)) {
    return false
  }

  if (value.type === "thread_digest") {
    return (
      Number.isSafeInteger(value.messageCount) &&
      (value.messageCount as number) >= 0 &&
      typeof value.summary === "string" &&
      typeof value.threadId === "string" &&
      isNullableString(value.title)
    )
  }

  return (
    value.type === "history_message" &&
    typeof value.messageId === "string" &&
    typeof value.role === "string" &&
    isNullableString(value.runId) &&
    typeof value.snippet === "string" &&
    typeof value.threadId === "string" &&
    (value.title === undefined || isNullableString(value.title)) &&
    isNullableString(value.toolCallId) &&
    isToolCalls(value.toolCalls)
  )
}

function isMessageContextToolResult(value: unknown): value is MessageContextToolResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.kind === "message_context" &&
    isStatus(value.status) &&
    isRecord(value.focus) &&
    typeof value.focus.messageId === "string" &&
    isNullableString(value.focus.runId) &&
    typeof value.focus.threadId === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isMessageContextResultItem) &&
    isOptionalDiagnostics(value.diagnostics) &&
    isNextActions(value.nextActions) &&
    typeof value.summary === "string" &&
    isRecord(value.window) &&
    Number.isSafeInteger(value.window.after) &&
    (value.window.after as number) >= 0 &&
    Number.isSafeInteger(value.window.before) &&
    (value.window.before as number) >= 0
  )
}

function isMessageContextResultItem(value: unknown): value is MessageContextResultItem {
  return (
    isRecord(value) &&
    typeof value.messageId === "string" &&
    typeof value.role === "string" &&
    isNullableString(value.runId) &&
    typeof value.text === "string" &&
    typeof value.threadId === "string" &&
    isNullableString(value.toolCallId) &&
    isToolCalls(value.toolCalls)
  )
}

function isTraceEvidenceToolResult(value: unknown): value is TraceEvidenceToolResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.kind === "trace_evidence" &&
    isStatus(value.status) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isTraceArtifactResultItem) &&
    isRecord(value.blobs) &&
    isTraceBlobResult(value.blobs.input) &&
    isTraceBlobResult(value.blobs.output) &&
    isOptionalDiagnostics(value.diagnostics) &&
    isNextActions(value.nextActions) &&
    typeof value.summary === "string" &&
    isTraceStepResult(value.step) &&
    isTraceResult(value.trace)
  )
}

function isTraceBlobResult(value: unknown): value is TraceBlobResult | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.kind === "string" &&
      isNullableString(value.preview) &&
      Number.isSafeInteger(value.sizeBytes) &&
      (value.sizeBytes as number) >= 0 &&
      typeof value.text === "string")
  )
}

function isTraceArtifactResultItem(value: unknown): value is TraceArtifactResultItem {
  return (
    isRecord(value) &&
    typeof value.artifactId === "string" &&
    typeof value.kind === "string" &&
    isNullableString(value.preview) &&
    isNullableString(value.runId) &&
    typeof value.status === "string" &&
    typeof value.threadId === "string" &&
    typeof value.title === "string" &&
    isNullableString(value.toolCallId)
  )
}

function isTraceStepResult(value: unknown): value is TraceEvidenceToolResult["step"] {
  return (
    value === null ||
    (isRecord(value) &&
      (value.durationMs === null ||
        (typeof value.durationMs === "number" &&
          Number.isFinite(value.durationMs) &&
          value.durationMs >= 0)) &&
      typeof value.status === "string" &&
      Number.isSafeInteger(value.stepIndex) &&
      (value.stepIndex as number) >= 0 &&
      typeof value.stepType === "string" &&
      isNullableString(value.toolCallId) &&
      isNullableString(value.toolName) &&
      typeof value.traceStepId === "string")
  )
}

function isTraceResult(value: unknown): value is TraceEvidenceToolResult["trace"] {
  return (
    isRecord(value) &&
    isNullableString(value.model) &&
    isNullableString(value.provider) &&
    isNullableString(value.runId) &&
    isNullableString(value.status) &&
    isNullableString(value.threadId) &&
    isNullableString(value.traceId)
  )
}
