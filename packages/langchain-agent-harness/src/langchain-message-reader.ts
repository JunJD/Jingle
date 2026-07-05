import { HumanMessage, type BaseMessage } from "@langchain/core/messages"
import { createHash } from "crypto"

export interface JingleLangChainTraceMessagesSummary {
  inputHash: string
  messageCount: number
  preview: string | null
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function readTraceContentPreview(content: unknown): string | null {
  if (typeof content === "string") {
    const preview = compactText(content).slice(0, 240)
    return preview.length > 0 ? preview : null
  }

  if (Array.isArray(content)) {
    const preview = compactText(JSON.stringify(content)).slice(0, 240)
    return preview.length > 0 ? preview : null
  }

  return null
}

function serializeTraceMessage(message: BaseMessage): Record<string, unknown> {
  const stored = message.toDict()
  return {
    id: stored.data.id ?? null,
    role: stored.data.role ?? stored.type,
    type: stored.type,
    content: stored.data.content,
    name: stored.data.name ?? null,
    toolCallId: stored.data.tool_call_id ?? null,
    additionalKwargs: stored.data.additional_kwargs ?? {},
    responseMetadata: stored.data.response_metadata ?? {}
  }
}

export function summarizeJingleLangChainTraceMessages(
  messages: BaseMessage[]
): JingleLangChainTraceMessagesSummary {
  const serializedMessages = messages.map(serializeTraceMessage)
  const inputJson = JSON.stringify(serializedMessages)
  const lastMessage = messages.at(-1)

  return {
    inputHash: createHash("sha256").update(inputJson).digest("hex"),
    messageCount: messages.length,
    preview: lastMessage ? readTraceContentPreview(lastMessage.content) : null
  }
}

export function readJingleLangChainMessageText(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block
      }

      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text
      }

      if (
        block &&
        typeof block === "object" &&
        "content" in block &&
        typeof block.content === "string"
      ) {
        return block.content
      }

      return ""
    })
    .filter(Boolean)
    .join("\n")
}

export function hasJingleLangChainToolCallSignal(message: BaseMessage): boolean {
  const observedMessage = message as BaseMessage & {
    additional_kwargs?: { tool_calls?: unknown[] }
    tool_call_chunks?: unknown[]
    tool_calls?: unknown[]
  }

  if (Array.isArray(observedMessage.tool_calls) && observedMessage.tool_calls.length > 0) {
    return true
  }

  if (
    Array.isArray(observedMessage.tool_call_chunks) &&
    observedMessage.tool_call_chunks.length > 0
  ) {
    return true
  }

  return (
    Array.isArray(observedMessage.additional_kwargs?.tool_calls) &&
    observedMessage.additional_kwargs.tool_calls.length > 0
  )
}

export function readLastJingleHumanMessage(messages: readonly BaseMessage[]): HumanMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (HumanMessage.isInstance(message)) {
      return message
    }
  }

  return null
}

export function readJingleHumanMessageRefsHint(message: HumanMessage): unknown {
  return (message.additional_kwargs as { refs?: unknown } | undefined)?.refs
}

export function appendTextToJingleHumanMessage(message: HumanMessage, text: string): HumanMessage {
  const content = message.content
  const nextContent =
    typeof content === "string"
      ? content.trim().length > 0
        ? `${content}\n\n${text}`
        : text
      : [...content, { text, type: "text" }]

  return new HumanMessage({
    additional_kwargs: message.additional_kwargs,
    content: nextContent,
    id: message.id,
    name: message.name,
    response_metadata: message.response_metadata
  })
}
