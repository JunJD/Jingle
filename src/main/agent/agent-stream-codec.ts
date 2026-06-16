import type { ToolCall as LangChainToolCall, ToolCallChunk } from "@langchain/core/messages"
import type { AgentTokenUsage } from "@shared/agent-thread-runtime"
import type {
  AgentInvokeMessage,
  AgentMessageContent
} from "@shared/message-content"
import {
  extractComposerMessageRefsMetadata,
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayAssistantMessageContent,
  toDisplayMessageContent,
  toDisplayUserMessageContent
} from "@shared/message-content"
import type {
  ContentBlock,
  HITLRequest,
  Message,
  Todo,
  ToolCall
} from "@shared/app-types"
import { extractHitlRequestFromValuesState } from "./runtime-state"

export interface UsageMetadata {
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

interface OpenAIToolCall {
  function?: {
    arguments?: string
    name?: string
  }
  id?: string
  type?: string
}

interface SerializedMessageChunk {
  id?: string | string[]
  kwargs?: {
    additional_kwargs?: {
      [key: string]: unknown
      refs?: unknown
      tool_calls?: OpenAIToolCall[]
    }
    content?: string | unknown[] | AgentMessageContent
    id?: string
    name?: string
    response_metadata?: {
      [key: string]: unknown
      usage?: UsageMetadata
    }
    tool_call_chunks?: ToolCallChunk[]
    tool_call_id?: string
    tool_calls?: LangChainToolCall[]
    status?: string
    usage_metadata?: UsageMetadata
  }
  lc?: number
  status?: string
  type?: string
}

interface StreamMessageMetadata {
  name?: unknown
}

interface ValuesInterruptState {
  __interrupt__?: unknown[]
  messages?: SerializedMessageChunk[]
  todos?: Array<{ content?: string; id?: string; status?: string }>
}

export interface DecodedAssistantChunk {
  content: Message["content"]
  id: string
  metadata?: Message["metadata"]
  toolCallChunks: ToolCallChunk[]
  toolCalls: ToolCall[]
  usageMetadata?: UsageMetadata
}

export interface DecodedToolMessageChunk {
  content: Message["content"]
  id: string
  metadata?: Message["metadata"]
  name?: string
  status: "success" | "error" | null
  toolCallId: string
}

export interface DecodedMessagesStreamPayload {
  assistant: DecodedAssistantChunk | null
  tool: DecodedToolMessageChunk | null
}

export interface DecodedValuesStreamPayload {
  messages: Message[] | null
  pendingApproval: HITLRequest | null
  todos: Todo[] | null
}

function getRequiredRuntimeRunId(runId: string | null): string {
  if (runId) {
    return runId
  }

  throw new Error("[AgentStreamCodec] Missing run id for interrupt state.")
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

function normalizeOpenAIToolCalls(toolCalls: readonly OpenAIToolCall[] | undefined): ToolCall[] {
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

function readAssistantToolCalls(kwargs: SerializedMessageChunk["kwargs"]): ToolCall[] {
  if (kwargs?.tool_calls?.length) {
    return kwargs.tool_calls as ToolCall[]
  }

  return normalizeOpenAIToolCalls(kwargs?.additional_kwargs?.tool_calls)
}

function getContentBlockText(block: ContentBlock): string {
  return block.text ?? block.content ?? ""
}

function getContentBlockReasoning(block: ContentBlock): string {
  return block.reasoning ?? block.text ?? block.content ?? ""
}

function toContentBlocks(content: Message["content"]): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content, type: "text" }] : []
  }

  return content
}

function appendContentBlocks(existing: ContentBlock[], incoming: ContentBlock[]): ContentBlock[] {
  const next = [...existing]

  for (const block of incoming) {
    const lastIndex = next.length - 1
    const last = lastIndex >= 0 ? next[lastIndex] : null

    if (block.type === "text") {
      const text = getContentBlockText(block)
      if (text.length === 0) {
        continue
      }

      if (last?.type === "text") {
        next[lastIndex] = {
          ...last,
          text: `${getContentBlockText(last)}${text}`
        }
        continue
      }
    }

    if (block.type === "reasoning") {
      const reasoning = getContentBlockReasoning(block)
      if (reasoning.length === 0) {
        continue
      }

      if (last?.type === "reasoning") {
        next[lastIndex] = {
          ...last,
          ...(block.signature ? { signature: block.signature } : {}),
          reasoning: `${getContentBlockReasoning(last)}${reasoning}`
        }
        continue
      }
    }

    next.push(block)
  }

  return next
}

function extractContent(
  content: string | unknown[] | AgentMessageContent | undefined
): string | ContentBlock[] {
  return toDisplayMessageContent(content)
}

function extractAssistantContent(kwargs: SerializedMessageChunk["kwargs"]): string | ContentBlock[] {
  return toDisplayAssistantMessageContent(kwargs?.content, {
    additional_kwargs: kwargs?.additional_kwargs,
    response_metadata: kwargs?.response_metadata
  })
}

function getSerializedMessageClassName(message: SerializedMessageChunk): string {
  if (Array.isArray(message.id)) {
    return message.id[message.id.length - 1] || ""
  }

  return typeof message.type === "string" ? message.type : ""
}

function resolveSerializedMessageRole(
  message: SerializedMessageChunk
): Message["role"] | null {
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

function getSerializedMessageId(
  message: SerializedMessageChunk,
  index: number,
  role: Message["role"]
): string {
  const kwargs = message.kwargs
  if (typeof kwargs?.id === "string" && kwargs.id.length > 0) {
    return kwargs.id
  }

  if (typeof message.id === "string" && message.id.length > 0) {
    return message.id
  }

  if (typeof kwargs?.tool_call_id === "string" && kwargs.tool_call_id.length > 0) {
    return kwargs.tool_call_id
  }

  return `values:${index}:${role}`
}

function decodeValuesMessage(message: SerializedMessageChunk, index: number): Message | null {
  const role = resolveSerializedMessageRole(message)
  if (!role) {
    return null
  }

  const kwargs = message.kwargs ?? {}
  const toolCalls = role === "assistant" ? readAssistantToolCalls(kwargs) : []
  const metadata = toComposerMessageMetadata({
    refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
  })
  const content =
    role === "assistant"
      ? extractAssistantContent(kwargs)
      : role === "user"
        ? toDisplayUserMessageContent(extractContent(kwargs.content), metadata)
        : extractContent(kwargs.content)

  return {
    content,
    created_at: new Date(),
    id: getSerializedMessageId(message, index, role),
    ...(metadata ? { metadata } : {}),
    name: kwargs.name,
    role,
    ...(kwargs.tool_call_id ? { tool_call_id: kwargs.tool_call_id } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  }
}

export function appendAssistantMessageContent(
  existing: Message["content"],
  incoming: Message["content"]
): Message["content"] {
  if (typeof existing === "string" && typeof incoming === "string") {
    return `${existing}${incoming}`
  }

  return appendContentBlocks(toContentBlocks(existing), toContentBlocks(incoming))
}

export function createUserRuntimeMessage(message: AgentInvokeMessage): Message {
  const refs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
  const metadata = toComposerMessageMetadata({ refs })

  return {
    content: toDisplayUserMessageContent(message.content, metadata),
    created_at: new Date(),
    id: message.id,
    ...(metadata ? { metadata } : {}),
    role: "user"
  }
}

export function decodeMessagesStreamPayload(
  data: unknown,
  currentMessageId: string | null
): DecodedMessagesStreamPayload {
  const [msgChunk, streamMetadata] = data as [SerializedMessageChunk, StreamMessageMetadata?]
  if (streamMetadata?.name === "thread_title") {
    return { assistant: null, tool: null }
  }

  const kwargs = msgChunk?.kwargs || {}
  const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : []
  const className = classId[classId.length - 1] || ""
  const isToolMessage = className.includes("ToolMessage") && !!kwargs.tool_call_id
  const isAIMessage = className.includes("AI") || className.includes("AIMessageChunk")
  let assistant: DecodedAssistantChunk | null = null
  let tool: DecodedToolMessageChunk | null = null

  if (isAIMessage) {
    const toolCalls = readAssistantToolCalls(kwargs)
    const content = extractAssistantContent(kwargs)
    const messageMetadata = toComposerMessageMetadata({
      refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
    })
    assistant = {
      content,
      id: kwargs.id || currentMessageId || crypto.randomUUID(),
      ...(messageMetadata ? { metadata: messageMetadata } : {}),
      toolCallChunks: kwargs.tool_call_chunks ?? [],
      toolCalls,
      usageMetadata: kwargs.usage_metadata || kwargs.response_metadata?.usage
    }
  }

  if (isToolMessage && kwargs.tool_call_id) {
    const messageMetadata = toComposerMessageMetadata({
      refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
    })
    tool = {
      content: extractContent(kwargs.content),
      id: kwargs.id || crypto.randomUUID(),
      ...(messageMetadata ? { metadata: messageMetadata } : {}),
      name: kwargs.name,
      status: kwargs.status === "error" || msgChunk.status === "error" ? "error" : null,
      toolCallId: kwargs.tool_call_id
    }
  }

  return { assistant, tool }
}

export function decodeValuesStreamPayload(
  data: unknown,
  input: { runId: string | null; threadId: string }
): DecodedValuesStreamPayload {
  const state = data as ValuesInterruptState
  const pendingApproval = state.__interrupt__?.length
    ? extractHitlRequestFromValuesState(
        input.threadId,
        getRequiredRuntimeRunId(input.runId),
        state
      )
    : null

  return {
    messages: state.messages?.flatMap((message, index) => {
      const decoded = decodeValuesMessage(message, index)
      return decoded ? [decoded] : []
    }) ?? null,
    pendingApproval,
    todos:
      state.todos === undefined
        ? null
        : state.todos.map((todo) => ({
            content: todo.content || "",
            id: todo.id || crypto.randomUUID(),
            status: (todo.status || "pending") as Todo["status"]
          }))
  }
}

export function sanitizeAssistantHistoryMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message
    }

    return {
      ...message,
      content: toDisplayAssistantMessageContent(message.content)
    }
  })
}

export function toTokenUsage(usageMetadata: UsageMetadata): AgentTokenUsage {
  return {
    cacheCreationTokens: usageMetadata.input_token_details?.cache_creation,
    cacheReadTokens: usageMetadata.input_token_details?.cache_read,
    inputTokens: usageMetadata.input_tokens || 0,
    lastUpdated: new Date(),
    outputTokens: usageMetadata.output_tokens || 0,
    totalTokens: usageMetadata.total_tokens || 0
  }
}
