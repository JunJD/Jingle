import type { ToolCall, ToolCallChunk } from "@langchain/core/messages"

export interface JingleLangGraphUsageMetadata {
  input_token_details?: {
    audio?: number
    cache_creation?: number
    cache_read?: number
  }
  input_tokens?: number
  output_token_details?: {
    audio?: number
    reasoning?: number
  }
  output_tokens?: number
  total_tokens?: number
}

export interface JingleLangGraphOpenAiToolCall {
  function?: {
    arguments?: string
    name?: string
  }
  id?: string
  type?: string
}

export interface JingleLangGraphToolCall {
  args: Record<string, unknown>
  id: string
  name: string
  type?: "tool_call"
}

export interface JingleLangGraphToolCallChunk {
  args?: string
  id?: string
  index?: number | null
  name?: string
}

export interface JingleLangGraphSerializedMessageChunk {
  additional_kwargs?: {
    [key: string]: unknown
    refs?: unknown
    tool_calls?: JingleLangGraphOpenAiToolCall[]
  }
  content?: string | unknown[]
  id?: string | string[]
  kwargs?: {
    additional_kwargs?: {
      [key: string]: unknown
      refs?: unknown
      tool_calls?: JingleLangGraphOpenAiToolCall[]
    }
    content?: string | unknown[]
    id?: string
    name?: string
    response_metadata?: {
      [key: string]: unknown
      usage?: JingleLangGraphUsageMetadata
    }
    tool_call_chunks?: ToolCallChunk[]
    tool_call_id?: string
    tool_calls?: ToolCall[]
    status?: string
    usage_metadata?: JingleLangGraphUsageMetadata
  }
  lc_id?: string[]
  lc_kwargs?: JingleLangGraphSerializedMessageChunk["kwargs"]
  lc_namespace?: string[]
  lc?: number
  name?: string
  response_metadata?: {
    [key: string]: unknown
    usage?: JingleLangGraphUsageMetadata
  }
  status?: string
  tool_call_chunks?: ToolCallChunk[]
  tool_call_id?: string
  tool_calls?: ToolCall[]
  type?: string
  usage_metadata?: JingleLangGraphUsageMetadata
}

export interface JingleLangGraphStreamMessageMetadata {
  name?: unknown
}

export type JingleLangGraphMessageRole = "assistant" | "system" | "tool" | "user"

export interface JingleLangGraphAssistantMessageChunk {
  additionalKwargs?: Record<string, unknown>
  content: string | unknown[] | undefined
  displayContext: JingleLangGraphStreamMessageDisplayContext
  id?: string
  metadataHints: JingleLangGraphStreamMessageMetadataHints
  responseMetadata?: Record<string, unknown>
  toolCallChunks: JingleLangGraphToolCallChunk[]
  toolCalls: JingleLangGraphToolCall[]
  usageMetadata?: JingleLangGraphUsageMetadata
}

export interface JingleLangGraphToolMessageChunk {
  additionalKwargs?: Record<string, unknown>
  content: string | unknown[] | undefined
  id?: string
  metadataHints: JingleLangGraphStreamMessageMetadataHints
  name?: string
  status: "error" | null
  toolCallId: string
}

export interface JingleLangGraphStreamMessageDisplayContext {
  additional_kwargs?: Record<string, unknown>
  response_metadata?: Record<string, unknown>
}

export interface JingleLangGraphStreamMessageMetadataHints {
  refs?: unknown
}

export interface JingleLangGraphMessagesStreamChunk {
  assistant: JingleLangGraphAssistantMessageChunk | null
  tool: JingleLangGraphToolMessageChunk | null
}

export interface JingleLangGraphValuesMessage {
  additionalKwargs?: Record<string, unknown>
  content: string | unknown[] | undefined
  displayContext: JingleLangGraphValuesMessageDisplayContext
  id?: string
  metadataHints: JingleLangGraphValuesMessageMetadataHints
  name?: string
  responseMetadata?: Record<string, unknown>
  role: JingleLangGraphMessageRole
  status: "error" | null
  topLevelId?: string
  toolCallId?: string
  toolCalls: JingleLangGraphToolCall[]
}

export interface JingleLangGraphValuesMessageDisplayContext {
  additional_kwargs?: Record<string, unknown>
  response_metadata?: Record<string, unknown>
}

export interface JingleLangGraphValuesMessageMetadataHints {
  refs?: unknown
}

export interface JingleLangGraphValuesState {
  approvals?: unknown
  compactions?: unknown
  contextInclusions?: unknown
  files?: unknown
  messages?: JingleLangGraphSerializedMessageChunk[]
  recordingRefs?: unknown
  tasks?: unknown
  todos?: Array<{ content?: string; id?: string; status?: string }>
  toolDecisions?: unknown
  workspacePath?: unknown
  __interrupt__?: unknown[]
}

export interface JingleLangGraphValuesStateRead {
  contextInclusions: unknown
  hasInterrupt: boolean
  messages: JingleLangGraphValuesMessage[] | null
  rawState: JingleLangGraphValuesState
  todos: Array<{ content?: string; id?: string; status?: string }> | null
}

function parseRequiredToolCallArgs(value: string | undefined): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }

    throw error
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  return parsed as Record<string, unknown>
}

function normalizeJingleLangGraphToolCalls(
  toolCalls: readonly ToolCall[] | undefined
): JingleLangGraphToolCall[] {
  return (toolCalls ?? []).flatMap((toolCall) => {
    if (!toolCall.id || !toolCall.name) {
      return []
    }

    return [
      {
        args: toolCall.args,
        id: toolCall.id,
        name: toolCall.name,
        type: "tool_call"
      }
    ]
  })
}

function normalizeOpenAiToolCalls(
  toolCalls: readonly JingleLangGraphOpenAiToolCall[] | undefined
): JingleLangGraphToolCall[] {
  return (toolCalls ?? []).flatMap((toolCall) => {
    const name = toolCall.function?.name
    const args = parseRequiredToolCallArgs(toolCall.function?.arguments)
    if (!toolCall.id || !name || !args) {
      return []
    }

    return [
      {
        args,
        id: toolCall.id,
        name,
        type: "tool_call"
      }
    ]
  })
}

function normalizeJingleLangGraphToolCallChunks(
  chunks: readonly ToolCallChunk[] | undefined
): JingleLangGraphToolCallChunk[] {
  return (chunks ?? []).map((chunk) => ({
    ...(typeof chunk.args === "string" ? { args: chunk.args } : {}),
    ...(typeof chunk.id === "string" ? { id: chunk.id } : {}),
    ...(typeof chunk.index === "number" ? { index: chunk.index } : {}),
    ...(typeof chunk.name === "string" ? { name: chunk.name } : {})
  }))
}

export function readJingleLangGraphAssistantToolCalls(
  kwargs: JingleLangGraphSerializedMessageChunk["kwargs"]
): JingleLangGraphToolCall[] {
  if (kwargs?.tool_calls?.length) {
    return normalizeJingleLangGraphToolCalls(kwargs.tool_calls)
  }

  return normalizeOpenAiToolCalls(kwargs?.additional_kwargs?.tool_calls)
}

function getSerializedMessageClassName(message: JingleLangGraphSerializedMessageChunk): string {
  if (Array.isArray(message.id)) {
    return message.id[message.id.length - 1] || ""
  }

  if (Array.isArray(message.lc_id)) {
    return message.lc_id[message.lc_id.length - 1] || ""
  }

  return typeof message.type === "string" ? message.type : ""
}

function readSerializedMessageKwargs(
  message: JingleLangGraphSerializedMessageChunk
): NonNullable<JingleLangGraphSerializedMessageChunk["kwargs"]> {
  return {
    ...(message.kwargs ?? message.lc_kwargs ?? {}),
    ...(message.content !== undefined ? { content: message.content } : {}),
    ...(message.id !== undefined && typeof message.id === "string" ? { id: message.id } : {}),
    ...(message.name !== undefined ? { name: message.name } : {}),
    ...(message.additional_kwargs !== undefined
      ? { additional_kwargs: message.additional_kwargs }
      : {}),
    ...(message.response_metadata !== undefined
      ? { response_metadata: message.response_metadata }
      : {}),
    ...(message.tool_call_chunks !== undefined
      ? { tool_call_chunks: message.tool_call_chunks }
      : {}),
    ...(message.tool_call_id !== undefined ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {}),
    ...(message.status !== undefined ? { status: message.status } : {}),
    ...(message.usage_metadata !== undefined ? { usage_metadata: message.usage_metadata } : {})
  }
}

export function resolveJingleLangGraphSerializedMessageRole(
  message: JingleLangGraphSerializedMessageChunk
): JingleLangGraphMessageRole | null {
  const className = getSerializedMessageClassName(message)
  if (className.includes("Human")) return "user"
  if (className.includes("System")) return "system"
  if (className.includes("Tool")) return "tool"
  if (className.includes("AI")) return "assistant"

  switch (message.type) {
    case "human":
      return "user"
    case "system":
      return "system"
    case "tool":
      return "tool"
    case "ai":
      return "assistant"
    default:
      return null
  }
}

function decodeValuesMessage(
  message: JingleLangGraphSerializedMessageChunk
): JingleLangGraphValuesMessage | null {
  const role = resolveJingleLangGraphSerializedMessageRole(message)
  if (!role) {
    return null
  }

  const kwargs = readSerializedMessageKwargs(message)
  const additionalKwargs = kwargs.additional_kwargs
  const responseMetadata = kwargs.response_metadata
  const displayContext: JingleLangGraphValuesMessageDisplayContext = {}
  if (additionalKwargs !== undefined) {
    displayContext.additional_kwargs = additionalKwargs
  }
  if (responseMetadata !== undefined) {
    displayContext.response_metadata = responseMetadata
  }

  return {
    additionalKwargs,
    content: kwargs.content,
    displayContext,
    id: kwargs.id,
    metadataHints: {
      refs: additionalKwargs?.refs
    },
    name: kwargs.name,
    responseMetadata,
    role,
    status: kwargs.status === "error" ? "error" : null,
    ...(typeof message.id === "string" && message.id.length > 0 ? { topLevelId: message.id } : {}),
    ...(kwargs.tool_call_id ? { toolCallId: kwargs.tool_call_id } : {}),
    toolCalls: role === "assistant" ? readJingleLangGraphAssistantToolCalls(kwargs) : []
  }
}

export function decodeJingleLangGraphMessagesStreamChunk(
  data: unknown
): JingleLangGraphMessagesStreamChunk {
  const [msgChunk, streamMetadata] = data as [
    JingleLangGraphSerializedMessageChunk,
    JingleLangGraphStreamMessageMetadata?
  ]
  if (streamMetadata?.name === "thread_title") {
    return { assistant: null, tool: null }
  }

  const kwargs = readSerializedMessageKwargs(msgChunk ?? {})
  const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : []
  const lcId = Array.isArray(msgChunk?.lc_id) ? msgChunk.lc_id : []
  const className = classId[classId.length - 1] || ""
  const lcClassName = lcId[lcId.length - 1] || ""
  const messageType = msgChunk?.type
  const isToolMessage =
    (className.includes("ToolMessage") ||
      lcClassName.includes("ToolMessage") ||
      messageType === "tool") &&
    !!kwargs.tool_call_id
  const isAIMessage =
    className.includes("AI") ||
    lcClassName.includes("AI") ||
    className.includes("AIMessageChunk") ||
    lcClassName.includes("AIMessageChunk") ||
    messageType === "ai"
  const additionalKwargs = kwargs.additional_kwargs
  const responseMetadata = kwargs.response_metadata
  const displayContext: JingleLangGraphStreamMessageDisplayContext = {}
  if (additionalKwargs !== undefined) {
    displayContext.additional_kwargs = additionalKwargs
  }
  if (responseMetadata !== undefined) {
    displayContext.response_metadata = responseMetadata
  }
  const metadataHints: JingleLangGraphStreamMessageMetadataHints = {
    refs: additionalKwargs?.refs
  }
  let assistant: JingleLangGraphAssistantMessageChunk | null = null
  let tool: JingleLangGraphToolMessageChunk | null = null

  if (isAIMessage) {
    assistant = {
      additionalKwargs,
      content: kwargs.content,
      displayContext,
      id: kwargs.id,
      metadataHints,
      responseMetadata,
      toolCallChunks: normalizeJingleLangGraphToolCallChunks(kwargs.tool_call_chunks),
      toolCalls: readJingleLangGraphAssistantToolCalls(kwargs),
      usageMetadata: kwargs.usage_metadata || kwargs.response_metadata?.usage
    }
  }

  if (isToolMessage && kwargs.tool_call_id) {
    tool = {
      additionalKwargs,
      content: kwargs.content,
      id: kwargs.id,
      metadataHints,
      name: kwargs.name,
      status: kwargs.status === "error" || msgChunk.status === "error" ? "error" : null,
      toolCallId: kwargs.tool_call_id
    }
  }

  return { assistant, tool }
}

export function readJingleLangGraphValuesState(data: unknown): JingleLangGraphValuesStateRead {
  const rawState = data as JingleLangGraphValuesState

  return {
    contextInclusions: rawState.contextInclusions,
    hasInterrupt: Array.isArray(rawState.__interrupt__) && rawState.__interrupt__.length > 0,
    messages:
      rawState.messages?.flatMap((message) => {
        const decoded = decodeValuesMessage(message)
        return decoded ? [decoded] : []
      }) ?? null,
    rawState,
    todos: rawState.todos ?? null
  }
}
