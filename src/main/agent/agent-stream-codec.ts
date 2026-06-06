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

interface SerializedMessageChunk {
  id?: string[]
  kwargs?: {
    additional_kwargs?: {
      [key: string]: unknown
      refs?: unknown
      tool_calls?: Array<{
        function?: {
          arguments?: string
          name?: string
        }
        id?: string
      }>
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
    usage_metadata?: UsageMetadata
  }
  lc?: number
  type?: string
}

interface ValuesInterruptState {
  __interrupt__?: unknown[]
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
  toolCallId: string
}

export interface DecodedMessagesStreamPayload {
  assistant: DecodedAssistantChunk | null
  tool: DecodedToolMessageChunk | null
}

export interface DecodedValuesStreamPayload {
  pendingApproval: HITLRequest | null
  todos: Todo[] | null
}

function getRequiredRuntimeRunId(runId: string | null): string {
  if (runId) {
    return runId
  }

  throw new Error("[AgentStreamCodec] Missing run id for interrupt state.")
}

function getToolCallNames(toolCalls: readonly { name?: string }[] | undefined): string[] {
  return Array.from(
    new Set(
      (toolCalls ?? [])
        .map((toolCall) => toolCall.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    )
  )
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

function extractAssistantContent(
  kwargs: SerializedMessageChunk["kwargs"],
  toolNames: readonly string[] = getToolCallNames(kwargs?.tool_calls)
): string | ContentBlock[] {
  return toDisplayAssistantMessageContent(kwargs?.content, {
    additional_kwargs: kwargs?.additional_kwargs,
    response_metadata: kwargs?.response_metadata,
    toolNames
  })
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
  const [msgChunk] = data as [SerializedMessageChunk]
  const kwargs = msgChunk?.kwargs || {}
  const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : []
  const className = classId[classId.length - 1] || ""
  const isToolMessage = className.includes("ToolMessage") && !!kwargs.tool_call_id
  const isAIMessage = className.includes("AI") || className.includes("AIMessageChunk")
  let assistant: DecodedAssistantChunk | null = null
  let tool: DecodedToolMessageChunk | null = null

  if (isAIMessage) {
    const content = extractAssistantContent(kwargs)
    const messageMetadata = toComposerMessageMetadata({
      refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
    })
    assistant = {
      content,
      id: kwargs.id || currentMessageId || crypto.randomUUID(),
      ...(messageMetadata ? { metadata: messageMetadata } : {}),
      toolCallChunks: kwargs.tool_call_chunks ?? [],
      toolCalls: (kwargs.tool_calls ?? []) as ToolCall[],
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
      content: toDisplayAssistantMessageContent(message.content, {
        toolNames: getToolCallNames(message.tool_calls)
      })
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
