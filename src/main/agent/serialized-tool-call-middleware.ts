import { randomUUID } from "node:crypto"
import { AIMessage, type ToolCall } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import {
  parseToolCallMarkup,
  stripToolCallMarkup,
  type ToolCallMarkupCall
} from "@shared/tool-call-markup"

const SERIALIZED_TOOL_CALL_SEQUENCE_KEY = "openwork_serialized_tool_call_sequence"

interface SerializedToolCallSequence {
  calls: ToolCall[]
  id: string
}

interface ToolLike {
  name?: unknown
  schema?: unknown
}

interface ToolFieldSchema {
  safeParse?: (value: unknown) => { success: boolean }
}

function getToolEntries(tools: readonly unknown[]): Array<{ name: string; schema?: unknown }> {
  return tools.flatMap((tool) => {
    const entry = tool as ToolLike
    return typeof entry.name === "string" ? [{ name: entry.name, schema: entry.schema }] : []
  })
}
function getToolNames(tools: readonly unknown[]): Set<string> {
  return new Set(getToolEntries(tools).map((tool) => tool.name))
}

function getToolSchemas(tools: readonly unknown[]): Map<string, unknown> {
  return new Map(getToolEntries(tools).map((tool) => [tool.name, tool.schema]))
}

function getObjectShape(schema: unknown): Record<string, ToolFieldSchema> | null {
  const shape = (schema as { shape?: unknown })?.shape
  return typeof shape === "object" && shape !== null
    ? (shape as Record<string, ToolFieldSchema>)
    : null
}

function parseJsonLiteral(value: string): { ok: true; value: unknown } | { ok: false } {
  if (!/^(?:true|false|null|-?\d|\{|\[|")/.test(value)) {
    return { ok: false }
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value) as unknown
    }
  } catch {
    return { ok: false }
  }
}

function fieldAcceptsValue(schema: ToolFieldSchema | undefined, value: unknown): boolean {
  return schema?.safeParse?.(value).success === true
}

function createSchemaAwareArgumentParser(tools: readonly unknown[]) {
  const toolSchemas = getToolSchemas(tools)

  return (input: { parameterName: string; rawValue: string; toolName: string }): unknown => {
    const schema = toolSchemas.get(input.toolName)
    const fieldSchema = getObjectShape(schema)?.[input.parameterName]

    if (fieldAcceptsValue(fieldSchema, input.rawValue)) {
      return input.rawValue
    }

    const parsed = parseJsonLiteral(input.rawValue)
    if (parsed.ok && (!fieldSchema || fieldAcceptsValue(fieldSchema, parsed.value))) {
      return parsed.value
    }

    return input.rawValue
  }
}

function toToolCall(call: ToolCallMarkupCall): ToolCall {
  return {
    args: call.args,
    id: `serialized-tool-call:${randomUUID()}`,
    name: call.name,
    type: "tool_call"
  }
}

function fingerprintToolCall(toolCall: Pick<ToolCall, "args" | "name">): string {
  return `${toolCall.name}:${JSON.stringify(toolCall.args ?? {})}`
}

function mergeToolCalls(
  existingToolCalls: ToolCall[] | undefined,
  parsedToolCalls: ToolCall[]
): ToolCall[] {
  const merged = existingToolCalls ? [...existingToolCalls] : []
  const existingFingerprints = new Set(merged.map(fingerprintToolCall))

  for (const toolCall of parsedToolCalls) {
    if (!existingFingerprints.has(fingerprintToolCall(toolCall))) {
      merged.push(toolCall)
    }
  }

  return merged
}

function normalizeContent(
  content: AIMessage["content"],
  parsedMarkupCalls: readonly ToolCallMarkupCall[]
): AIMessage["content"] {
  return typeof content === "string" ? stripToolCallMarkup(content, parsedMarkupCalls) : content
}

function createSequence(toolCalls: ToolCall[]): SerializedToolCallSequence {
  return {
    calls: toolCalls,
    id: `serialized-tool-call-sequence:${randomUUID()}`
  }
}

function withSequence(
  additionalKwargs: AIMessage["additional_kwargs"],
  sequence: SerializedToolCallSequence
): AIMessage["additional_kwargs"] {
  return {
    ...additionalKwargs,
    [SERIALIZED_TOOL_CALL_SEQUENCE_KEY]: sequence
  }
}

function getMessageAdditionalKwargs(message: unknown): Record<string, unknown> | null {
  const additionalKwargs = (message as { additional_kwargs?: unknown }).additional_kwargs
  return typeof additionalKwargs === "object" && additionalKwargs !== null
    ? (additionalKwargs as Record<string, unknown>)
    : null
}

function getMessageType(message: unknown): string {
  const getType = (message as { _getType?: unknown })._getType
  return typeof getType === "function" ? String(getType.call(message)) : ""
}

function getToolMessageCallId(message: unknown): string | null {
  if (getMessageType(message) !== "tool") {
    return null
  }

  const toolCallId = (message as { tool_call_id?: unknown }).tool_call_id
  return typeof toolCallId === "string" && toolCallId.length > 0 ? toolCallId : null
}

function isHumanMessage(message: unknown): boolean {
  return getMessageType(message) === "human"
}

function readSequence(message: unknown): SerializedToolCallSequence | null {
  const sequence = getMessageAdditionalKwargs(message)?.[SERIALIZED_TOOL_CALL_SEQUENCE_KEY]
  if (!sequence || typeof sequence !== "object") {
    return null
  }

  const { calls, id } = sequence as { calls?: unknown; id?: unknown }
  if (typeof id !== "string" || !Array.isArray(calls)) {
    return null
  }

  return {
    calls: calls as ToolCall[],
    id
  }
}

function getNextSequenceToolCall(messages: readonly unknown[]): {
  sequence: SerializedToolCallSequence
  toolCall: ToolCall
} | null {
  const lastHumanIndex = messages.findLastIndex(isHumanMessage)
  const activeMessages = messages.slice(lastHumanIndex + 1)
  const sequenceMessage = activeMessages.findLast((message) => readSequence(message) !== null)
  const sequence = sequenceMessage ? readSequence(sequenceMessage) : null
  if (!sequence) {
    return null
  }

  const completedToolCallIds = new Set(
    activeMessages.flatMap((message) => getToolMessageCallId(message) ?? [])
  )
  const nextToolCall = sequence.calls.find(
    (toolCall) => !completedToolCallIds.has(toolCall.id ?? "")
  )

  if (!nextToolCall || nextToolCall.id === sequence.calls[0]?.id) {
    return null
  }

  return {
    sequence,
    toolCall: nextToolCall
  }
}

function buildQueuedToolCallMessage(
  sequence: SerializedToolCallSequence,
  toolCall: ToolCall
): AIMessage {
  return new AIMessage({
    additional_kwargs: {
      [SERIALIZED_TOOL_CALL_SEQUENCE_KEY]: sequence
    },
    content: "",
    tool_calls: [toolCall]
  })
}

function normalizeSerializedToolCallMessage(
  response: AIMessage,
  tools: readonly unknown[]
): AIMessage {
  const text = response.text
  const parsedMarkupCalls = parseToolCallMarkup(text, {
    availableToolNames: getToolNames(tools),
    parseArgumentValue: createSchemaAwareArgumentParser(tools)
  })
  const parsedToolCalls = parsedMarkupCalls.map(toToolCall)
  const mergedToolCalls = mergeToolCalls(response.tool_calls, parsedToolCalls)

  if (parsedToolCalls.length === 0) {
    return response
  }

  const sequence = mergedToolCalls.length > 1 ? createSequence(mergedToolCalls) : null

  return new AIMessage({
    additional_kwargs: sequence
      ? withSequence(response.additional_kwargs, sequence)
      : response.additional_kwargs,
    content: normalizeContent(response.content, parsedMarkupCalls),
    id: response.id,
    invalid_tool_calls: response.invalid_tool_calls,
    name: response.name,
    response_metadata: response.response_metadata,
    tool_calls: sequence ? [mergedToolCalls[0]] : mergedToolCalls,
    usage_metadata: response.usage_metadata
  })
}

export function createSerializedToolCallMiddleware() {
  return createMiddleware({
    name: "SerializedToolCallMiddleware",
    wrapModelCall: async (request, handler) => {
      const nextQueuedToolCall = getNextSequenceToolCall(
        (request as { messages?: readonly unknown[] }).messages ?? []
      )
      if (nextQueuedToolCall) {
        return buildQueuedToolCallMessage(nextQueuedToolCall.sequence, nextQueuedToolCall.toolCall)
      }

      const response = await handler(request)

      if (!AIMessage.isInstance(response)) {
        return response
      }

      return normalizeSerializedToolCallMessage(response, request.tools)
    }
  })
}
