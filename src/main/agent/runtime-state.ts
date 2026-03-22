import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import type { HitlRequestRow } from "../db"
import type { HITLRequest, Todo, ToolCall } from "../types"

interface CheckpointChannelMessage {
  id?: string
  kwargs?: {
    id?: string
    content?: string | unknown[]
    tool_calls?: ToolCall[]
    additional_kwargs?: {
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

interface InterruptActionRequest {
  id?: string
  name: string
  args?: Record<string, unknown>
}

interface InterruptReviewConfig {
  actionName: string
  allowedDecisions: Array<"approve" | "reject" | "edit">
}

interface CheckpointInterruptValue {
  actionRequests?: InterruptActionRequest[]
  reviewConfigs?: InterruptReviewConfig[]
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

function findMatchingToolCallIdFromCheckpointMessages(
  messages: CheckpointChannelMessage[] | undefined,
  actionName: string,
  actionArgs: Record<string, unknown>
): string | undefined {
  if (!Array.isArray(messages)) {
    return undefined
  }

  const expectedArgs = stableStringify(actionArgs)

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = getCheckpointToolCalls(messages[index]!)
    if (toolCalls.length === 0) {
      continue
    }

    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = toolCalls[toolIndex]
      if (toolCall.name !== actionName) {
        continue
      }

      if (stableStringify(toolCall.args ?? {}) === expectedArgs) {
        return toolCall.id
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = getCheckpointToolCalls(messages[index]!)
    if (toolCalls.length === 0) {
      continue
    }

    const fallback = toolCalls.find((toolCall) => toolCall.name === actionName)
    if (fallback?.id) {
      return fallback.id
    }
  }

  return undefined
}

function findMatchingToolCallIdFromStateMessages(
  messages: ValuesStateMessage[] | undefined,
  actionName: string,
  actionArgs: Record<string, unknown>
): string | undefined {
  if (!Array.isArray(messages)) {
    return undefined
  }

  const expectedArgs = stableStringify(actionArgs)

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = messages[index]?.kwargs?.tool_calls
    if (!Array.isArray(toolCalls)) {
      continue
    }

    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = toolCalls[toolIndex]
      if (toolCall.name !== actionName) {
        continue
      }

      if (stableStringify(toolCall.args ?? {}) === expectedArgs) {
        return toolCall.id
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = messages[index]?.kwargs?.tool_calls
    if (!Array.isArray(toolCalls)) {
      continue
    }

    const fallback = toolCalls.find((toolCall) => toolCall.name === actionName)
    if (fallback?.id) {
      return fallback.id
    }
  }

  return undefined
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
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
          : ""
    const toolCalls = getCheckpointToolCalls(message)
    const messageId = getCheckpointMessageId(threadId, index, role, message)

    return {
      message_id: messageId,
      role,
      kind: role === "tool" ? "tool_result" : "message",
      content: JSON.stringify(content),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
      tool_call_id: message.kwargs?.tool_call_id ?? message.tool_call_id ?? null,
      name: message.kwargs?.name ?? message.name ?? null,
      metadata: null,
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
  tuple: CheckpointTuple | undefined
): HITLRequest | null {
  const state = tuple as LatestCheckpointState | undefined
  const interruptValue = state?.checkpoint?.channel_values?.__interrupt__?.[0]?.value
  const action = interruptValue?.actionRequests?.[0]

  if (!action) {
    return null
  }

  const checkpointId = state?.checkpoint?.id || "latest"
  const toolArgs = action.args || {}
  const toolCallId =
    findMatchingToolCallIdFromCheckpointMessages(
      state?.checkpoint?.channel_values?.messages,
      action.name,
      toolArgs
    ) ||
    action.id ||
    undefined
  const requestId = toolCallId || `hitl:${threadId}:${checkpointId}:${action.name}`
  const allowedDecisions = interruptValue?.reviewConfigs?.find(
    (config) => config.actionName === action.name
  )?.allowedDecisions || ["approve", "reject", "edit"]

  return {
    id: requestId,
    tool_call: {
      id: toolCallId || requestId,
      name: action.name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions
  }
}

export function extractHitlRequestFromValuesState(
  threadId: string,
  runId: string,
  data: unknown
): HITLRequest | null {
  const state = data as ValuesRuntimeState | undefined
  const interruptValue = state?.__interrupt__?.[0]?.value
  const action = interruptValue?.actionRequests?.[0]

  if (!action) {
    return null
  }

  const toolArgs = action.args || {}
  const toolCallId =
    findMatchingToolCallIdFromStateMessages(state?.messages, action.name, toolArgs) ||
    action.id ||
    undefined
  const requestId = toolCallId || `hitl:${threadId}:${runId}:${action.name}`
  const allowedDecisions = interruptValue?.reviewConfigs?.find(
    (config) => config.actionName === action.name
  )?.allowedDecisions || ["approve", "reject", "edit"]

  return {
    id: requestId,
    tool_call: {
      id: toolCallId || requestId,
      name: action.name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions
  }
}

export function mapHitlRowToRequest(row: HitlRequestRow): HITLRequest {
  let toolArgs: Record<string, unknown> = {}
  let allowedDecisions: HITLRequest["allowed_decisions"] = ["approve", "reject", "edit"]

  try {
    toolArgs = JSON.parse(row.tool_args) as Record<string, unknown>
  } catch {
    toolArgs = {}
  }

  try {
    const parsed = JSON.parse(row.allowed_decisions) as HITLRequest["allowed_decisions"]
    if (Array.isArray(parsed)) {
      allowedDecisions = parsed
    }
  } catch {
    allowedDecisions = ["approve", "reject", "edit"]
  }

  return {
    id: row.request_id,
    tool_call: {
      id: row.tool_call_id || row.request_id,
      name: row.tool_name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions
  }
}
