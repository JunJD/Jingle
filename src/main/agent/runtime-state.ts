import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import type { ActionRequest, ReviewConfig } from "langchain"
import type { HitlRequestRow } from "../db"
import type { HITLRequest, Todo, ToolCall } from "../types"
import { getDefaultHitlAllowedDecisions, normalizeHitlAllowedDecisions } from "../../shared/hitl"
import { parseToolApprovalItem } from "../../shared/tool-approval"
import {
  toComposerMessageMetadata,
  normalizeComposerMessageRefs
} from "../../shared/message-content"

interface CheckpointChannelMessage {
  id?: string
  kwargs?: {
    id?: string
    content?: string | unknown[]
    tool_calls?: ToolCall[]
    additional_kwargs?: {
      refs?: unknown
      tool_calls?: Array<{
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    tool_call_id?: string
    name?: string
  }
  _getType?: () => string
  type?: string
  content?: string | unknown[]
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

interface InterruptActionRequest extends ActionRequest {
  id?: string
  toolCallId?: string
  description?: string
  review?: unknown
}

interface CheckpointInterruptValue {
  actionRequests?: InterruptActionRequest[]
  reviewConfigs?: ReviewConfig[]
}

interface LatestCheckpointState {
  checkpoint?: {
    id?: string
    channel_values?: {
      messages?: CheckpointChannelMessage[]
      todos?: Array<{ id?: string; content?: string; status?: string }>
      __interrupt__?: Array<{
        value?: CheckpointInterruptValue
      }>
    }
  }
}

interface ValuesStateMessage {
  kwargs?: {
    tool_calls?: ToolCall[]
  }
}

interface ValuesRuntimeState {
  messages?: ValuesStateMessage[]
  __interrupt__?: Array<{
    value?: CheckpointInterruptValue
  }>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getSerializedMessageClassName(message: CheckpointChannelMessage): string {
  return Array.isArray(message.id) ? message.id[message.id.length - 1] || "" : ""
}

function getCheckpointMessageContent(message: CheckpointChannelMessage): string | unknown[] {
  return message.kwargs?.content ?? message.content ?? ""
}

function getCheckpointToolCalls(message: CheckpointChannelMessage): ToolCall[] {
  const direct = message.kwargs?.tool_calls ?? message.tool_calls
  if (Array.isArray(direct) && direct.length > 0) {
    return direct as ToolCall[]
  }

  const openAiToolCalls = message.kwargs?.additional_kwargs?.tool_calls
  if (Array.isArray(openAiToolCalls) && openAiToolCalls.length > 0) {
    return openAiToolCalls.map((toolCall, index) => ({
      id: toolCall.id || `checkpoint-tool-${index}`,
      name: toolCall.function?.name || "unknown",
      args: parseJsonRecord(toolCall.function?.arguments)
    }))
  }

  return []
}

function getCheckpointMessageMetadata(
  message: CheckpointChannelMessage
): Record<string, unknown> | null {
  const refs = normalizeComposerMessageRefs(message.kwargs?.additional_kwargs?.refs)
  return toComposerMessageMetadata({ refs }) ?? null
}

function getCheckpointMessageId(
  threadId: string,
  index: number,
  role: string,
  message: CheckpointChannelMessage
): string {
  if (typeof message.kwargs?.id === "string" && message.kwargs.id.length > 0) {
    return message.kwargs.id
  }

  if (typeof message.tool_call_id === "string" && message.tool_call_id.length > 0) {
    return message.tool_call_id
  }

  if (typeof message.kwargs?.tool_call_id === "string" && message.kwargs.tool_call_id.length > 0) {
    return message.kwargs.tool_call_id
  }

  return `checkpoint:${threadId}:${index}:${role}`
}

function getLatestCheckpointToolCalls(
  messages: CheckpointChannelMessage[] | undefined
): ToolCall[] {
  if (!Array.isArray(messages)) {
    return []
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = getCheckpointToolCalls(messages[index]!)
    if (toolCalls.length > 0) {
      return toolCalls
    }
  }

  return []
}

function getLatestValuesToolCalls(messages: ValuesStateMessage[] | undefined): ToolCall[] {
  if (!Array.isArray(messages)) {
    return []
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = messages[index]?.kwargs?.tool_calls
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      return toolCalls
    }
  }

  return []
}

function getInterruptCandidateToolCalls(
  toolCalls: ToolCall[],
  interruptValue: CheckpointInterruptValue | undefined
): ToolCall[] {
  const interruptNames = new Set([
    ...(interruptValue?.actionRequests ?? []).map((action) => action.name),
    ...(interruptValue?.reviewConfigs ?? []).map((config) => config.actionName)
  ])

  if (interruptNames.size === 0) {
    return []
  }

  return toolCalls.filter((toolCall) => interruptNames.has(toolCall.name))
}

function findInterruptedToolCall(
  toolCalls: ToolCall[],
  interruptValue: CheckpointInterruptValue | undefined,
  actionIndex: number
): ToolCall | undefined {
  // Legacy fallback for checkpoints created before the custom middleware
  // started writing toolCallId directly into the interrupt payload.
  const action = interruptValue?.actionRequests?.[actionIndex]
  if (!action) {
    return undefined
  }

  const interruptToolCalls = getInterruptCandidateToolCalls(toolCalls, interruptValue)
  const positionalMatch = interruptToolCalls[actionIndex]
  const expectedArgs = stableStringify(action.args || {})

  if (
    positionalMatch &&
    positionalMatch.name === action.name &&
    stableStringify(positionalMatch.args ?? {}) === expectedArgs
  ) {
    return positionalMatch
  }

  return undefined
}

function getInterruptActionToolCallId(
  action: InterruptActionRequest | undefined
): string | undefined {
  if (typeof action?.toolCallId === "string" && action.toolCallId.length > 0) {
    return action.toolCallId
  }

  return undefined
}

function getInterruptActionReview(action: InterruptActionRequest | undefined) {
  return parseToolApprovalItem(action?.review)
}

export function extractMessagesFromCheckpoint(
  threadId: string,
  tuple: CheckpointTuple | undefined
): Array<{
  message_id: string
  role: string
  kind: string
  content: string
  tool_calls?: string | null
  tool_call_id?: string | null
  name?: string | null
  metadata?: string | null
  created_at: number
}> {
  const state = tuple as LatestCheckpointState | undefined
  const messages = state?.checkpoint?.channel_values?.messages
  if (!Array.isArray(messages)) {
    return []
  }

  const now = Date.now()

  return messages.map((message, index) => {
    const role = resolveMessageRole(message)
    const rawContent = getCheckpointMessageContent(message)
    const content =
      typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent : ""
    const toolCalls = getCheckpointToolCalls(message)
    const messageId = getCheckpointMessageId(threadId, index, role, message)
    const messageMetadata = getCheckpointMessageMetadata(message)

    return {
      message_id: messageId,
      role,
      kind: role === "tool" ? "tool_result" : "message",
      content: JSON.stringify(content),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
      tool_call_id: message.kwargs?.tool_call_id ?? message.tool_call_id ?? null,
      name: message.kwargs?.name ?? message.name ?? null,
      metadata: messageMetadata ? JSON.stringify(messageMetadata) : null,
      created_at: now + index
    }
  })
}

function resolveMessageRole(
  message: CheckpointChannelMessage
): "user" | "assistant" | "system" | "tool" {
  const className = getSerializedMessageClassName(message)
  if (className.includes("Human")) return "user"
  if (className.includes("System")) return "system"
  if (className.includes("Tool")) return "tool"
  if (className.includes("AI")) return "assistant"

  if (typeof message._getType === "function") {
    const type = message._getType()
    if (type === "human") return "user"
    if (type === "system") return "system"
    if (type === "tool") return "tool"
    return "assistant"
  }

  if (message.type === "human") return "user"
  if (message.type === "system") return "system"
  if (message.type === "tool") return "tool"
  return "assistant"
}

export function extractTodosFromCheckpoint(tuple: CheckpointTuple | undefined): Todo[] {
  const state = tuple as LatestCheckpointState | undefined
  const todos = state?.checkpoint?.channel_values?.todos

  if (!Array.isArray(todos)) {
    return []
  }

  return todos.map((todo, index) => ({
    id: todo.id || `todo-${index}`,
    content: todo.content || "",
    status: (todo.status || "pending") as Todo["status"]
  }))
}

export function extractHitlRequestFromCheckpoint(
  threadId: string,
  tuple: CheckpointTuple | undefined,
  options?: {
    runId?: string | null
  }
): HITLRequest | null {
  const state = tuple as LatestCheckpointState | undefined
  const interruptValue = state?.checkpoint?.channel_values?.__interrupt__?.[0]?.value
  const actionIndex = 0
  const action = interruptValue?.actionRequests?.[actionIndex]

  if (!action) {
    return null
  }

  const checkpointId = state?.checkpoint?.id || "latest"
  const toolArgs = action.args || {}
  const latestToolCalls = getLatestCheckpointToolCalls(state?.checkpoint?.channel_values?.messages)
  const matchedToolCall = findInterruptedToolCall(latestToolCalls, interruptValue, actionIndex)
  const toolCallId = getInterruptActionToolCallId(action) || matchedToolCall?.id
  const requestContextId = options?.runId || checkpointId
  const requestKey = toolCallId || action.id || `${actionIndex}:${action.name}`
  const requestId = `hitl:${threadId}:${requestContextId}:${requestKey}`
  const allowedDecisions = normalizeHitlAllowedDecisions(
    interruptValue?.reviewConfigs?.find((config) => config.actionName === action.name)
      ?.allowedDecisions
  )

  return {
    id: requestId,
    tool_call: {
      ...(toolCallId ? { id: toolCallId } : {}),
      name: action.name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions,
    review: getInterruptActionReview(action)
  }
}

export function extractHitlRequestFromValuesState(
  threadId: string,
  runId: string,
  data: unknown
): HITLRequest | null {
  const state = data as ValuesRuntimeState | undefined
  const interruptValue = state?.__interrupt__?.[0]?.value
  const actionIndex = 0
  const action = interruptValue?.actionRequests?.[actionIndex]

  if (!action) {
    return null
  }

  const toolArgs = action.args || {}
  const latestToolCalls = getLatestValuesToolCalls(state?.messages)
  const matchedToolCall = findInterruptedToolCall(latestToolCalls, interruptValue, actionIndex)
  const toolCallId = getInterruptActionToolCallId(action) || matchedToolCall?.id
  const requestKey = toolCallId || action.id || `${actionIndex}:${action.name}`
  const requestId = `hitl:${threadId}:${runId}:${requestKey}`
  const allowedDecisions = normalizeHitlAllowedDecisions(
    interruptValue?.reviewConfigs?.find((config) => config.actionName === action.name)
      ?.allowedDecisions
  )

  return {
    id: requestId,
    tool_call: {
      ...(toolCallId ? { id: toolCallId } : {}),
      name: action.name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions,
    review: getInterruptActionReview(action)
  }
}

export function mapHitlRowToRequest(row: HitlRequestRow): HITLRequest {
  let toolArgs: Record<string, unknown> = {}
  let allowedDecisions: HITLRequest["allowed_decisions"] = getDefaultHitlAllowedDecisions()
  let review: HITLRequest["review"] = null

  try {
    toolArgs = JSON.parse(row.tool_args) as Record<string, unknown>
  } catch {
    toolArgs = {}
  }

  try {
    allowedDecisions = normalizeHitlAllowedDecisions(JSON.parse(row.allowed_decisions))
  } catch {
    allowedDecisions = getDefaultHitlAllowedDecisions()
  }

  try {
    review = parseToolApprovalItem(row.review_payload ? JSON.parse(row.review_payload) : null)
  } catch {
    review = null
  }

  return {
    id: row.request_id,
    tool_call: {
      ...(row.tool_call_id ? { id: row.tool_call_id } : {}),
      name: row.tool_name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions,
    review
  }
}
