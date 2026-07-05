import {
  decodeJingleLangGraphMessagesStreamChunk,
  projectJingleValuesStateForHost,
  projectJinglePendingApprovalRequestFromValues,
  readJingleLangGraphValuesState,
  type JingleLangGraphToolCall,
  type JingleLangGraphToolCallChunk,
  type JingleLangGraphUsageMetadata,
  type JingleLangGraphValuesMessage
} from "@jingle/langchain-agent-harness/transitional"
import type { JingleTokenUsage } from "@jingle/agent-client"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { AgentInvokeMessage, AgentMessageContent } from "@shared/message-content"
import {
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayAssistantMessageContent,
  toDisplayMessageContent,
  toDisplayUserMessageContent
} from "@shared/message-content"
import type { ContentBlock, HITLRequest, Message, Todo, ToolCall } from "@shared/app-types"
import { parseToolApprovalItem } from "@shared/tool-approval"

export type UsageMetadata = JingleLangGraphUsageMetadata

export interface DecodedAssistantChunk {
  content: Message["content"]
  id: string
  metadata?: Message["metadata"]
  toolCallChunks: JingleLangGraphToolCallChunk[]
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
  contextInclusions: AgentContextInclusion[] | null
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

function getSerializedMessageId(
  message: JingleLangGraphValuesMessage,
  index: number,
  role: Message["role"]
): string {
  if (typeof message.id === "string" && message.id.length > 0) {
    return message.id
  }

  if (typeof message.topLevelId === "string" && message.topLevelId.length > 0) {
    return message.topLevelId
  }

  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
    return message.toolCallId
  }

  return `values:${index}:${role}`
}

function toJingleToolCalls(toolCalls: readonly JingleLangGraphToolCall[]): ToolCall[] {
  return toolCalls.flatMap((toolCall) => {
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

function decodeValuesMessage(message: JingleLangGraphValuesMessage, index: number): Message {
  const metadata = toComposerMessageMetadata({
    refs: normalizeComposerMessageRefs(message.metadataHints.refs)
  })
  const content =
    message.role === "assistant"
      ? toDisplayAssistantMessageContent(message.content, message.displayContext)
      : message.role === "user"
        ? toDisplayUserMessageContent(extractContent(message.content), metadata)
        : extractContent(message.content)

  return {
    content,
    created_at: new Date(),
    id: getSerializedMessageId(message, index, message.role),
    ...(metadata ? { metadata } : {}),
    name: message.name,
    role: message.role,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls.length > 0 ? { tool_calls: toJingleToolCalls(message.toolCalls) } : {})
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

export function createUserRuntimeMessage(
  message: AgentInvokeMessage,
  options: { createdAt?: Date; metadata?: Record<string, unknown> } = {}
): Message {
  const refs = normalizeComposerMessageRefs(message.refs)
  const metadata = toComposerMessageMetadata({ refs })

  return {
    content: toDisplayUserMessageContent(message.content, metadata),
    created_at: options.createdAt ?? new Date(),
    id: message.id,
    ...(metadata || options.metadata
      ? { metadata: { ...(metadata ?? {}), ...(options.metadata ?? {}) } }
      : {}),
    role: "user"
  }
}

export function decodeMessagesStreamPayload(
  data: unknown,
  currentMessageId: string | null
): DecodedMessagesStreamPayload {
  const decoded = decodeJingleLangGraphMessagesStreamChunk(data)
  let assistant: DecodedAssistantChunk | null = null
  let tool: DecodedToolMessageChunk | null = null

  if (decoded.assistant) {
    const messageMetadata = toComposerMessageMetadata({
      refs: normalizeComposerMessageRefs(decoded.assistant.metadataHints.refs)
    })
    assistant = {
      content: toDisplayAssistantMessageContent(
        decoded.assistant.content,
        decoded.assistant.displayContext
      ),
      id: decoded.assistant.id || currentMessageId || crypto.randomUUID(),
      ...(messageMetadata ? { metadata: messageMetadata } : {}),
      toolCallChunks: decoded.assistant.toolCallChunks,
      toolCalls: toJingleToolCalls(decoded.assistant.toolCalls),
      usageMetadata: decoded.assistant.usageMetadata
    }
  }

  if (decoded.tool) {
    const messageMetadata = toComposerMessageMetadata({
      refs: normalizeComposerMessageRefs(decoded.tool.metadataHints.refs)
    })
    tool = {
      content: extractContent(decoded.tool.content),
      id: decoded.tool.id || crypto.randomUUID(),
      ...(messageMetadata ? { metadata: messageMetadata } : {}),
      name: decoded.tool.name,
      status: decoded.tool.status,
      toolCallId: decoded.tool.toolCallId
    }
  }

  return { assistant, tool }
}

export function decodeValuesStreamPayload(
  data: unknown,
  input: { runId: string | null; threadId: string }
): DecodedValuesStreamPayload {
  const decoded = readJingleLangGraphValuesState(data)
  const hostProjection = projectJingleValuesStateForHost(data)
  const pendingApproval = decoded.hasInterrupt
    ? projectJinglePendingApprovalRequestFromValues({
        data: decoded.rawState,
        parseReview: parseToolApprovalItem,
        runId: getRequiredRuntimeRunId(input.runId),
        threadId: input.threadId
      })
    : null

  return {
    contextInclusions:
      (hostProjection.contextInclusions as AgentContextInclusion[] | undefined) ?? null,
    messages:
      decoded.messages?.map((message, index) => decodeValuesMessage(message, index)) ?? null,
    pendingApproval,
    todos:
      hostProjection.todos === undefined
        ? null
        : hostProjection.todos.map((todo) => ({
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

export function toTokenUsage(usageMetadata: UsageMetadata): JingleTokenUsage {
  return {
    cacheCreationTokens: usageMetadata.input_token_details?.cache_creation,
    cacheReadTokens: usageMetadata.input_token_details?.cache_read,
    inputTokens: usageMetadata.input_tokens || 0,
    lastUpdated: new Date().toISOString(),
    outputTokens: usageMetadata.output_tokens || 0,
    totalTokens: usageMetadata.total_tokens || 0
  }
}
