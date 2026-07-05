import {
  AIMessage,
  ToolMessage,
  type DirectToolOutput,
  type MessageContent,
  type ToolCall
} from "@langchain/core/messages"
import { Command, isGraphInterrupt } from "@langchain/langgraph"
import type { ToolRuntime } from "langchain"

export type JingleToolResultStatus = "error" | "success"

export interface JingleToolResultMessageInput {
  content: MessageContent
  name: string
  status?: JingleToolResultStatus
  toolCallId: string
}

export type JingleAiToolCall = ToolCall & Record<string, unknown>

export type JingleAiToolCallMapper = (toolCall: JingleAiToolCall) => JingleAiToolCall

export interface BuildJingleToolResultUpdateCommandInput<
  TUpdate extends object = Record<string, unknown>
> {
  toolResult: JingleToolResultMessageInput
  update?: Omit<TUpdate, "messages">
}

export type JingleToolResultCommandUpdate<TUpdate extends object = Record<string, unknown>> = Omit<
  TUpdate,
  "messages"
> & {
  messages: ToolMessage[]
}

export type JingleToolResultUpdateCommand<TUpdate extends object = Record<string, unknown>> =
  Command<unknown, JingleToolResultCommandUpdate<TUpdate>> & DirectToolOutput

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : null
}

export function getRunIdFromToolRuntime(runtime: ToolRuntime): string | null {
  return (
    readStringField(runtime.metadata, "run_id") ??
    readStringField(runtime.config?.metadata, "run_id") ??
    readStringField(runtime.configurable, "run_id") ??
    readStringField(runtime.config?.configurable, "run_id")
  )
}

export function getToolCallIdFromToolRuntime(runtime: ToolRuntime): string | null {
  const directToolCallId = (runtime as ToolRuntime & { toolCallId?: unknown }).toolCallId
  if (typeof directToolCallId === "string" && directToolCallId.length > 0) {
    return directToolCallId
  }

  const toolCall = (runtime as ToolRuntime & { toolCall?: { id?: unknown } }).toolCall
  return typeof toolCall?.id === "string" && toolCall.id.length > 0 ? toolCall.id : null
}

function buildJingleToolResultMessage(input: JingleToolResultMessageInput): ToolMessage {
  const { content, name, status, toolCallId } = input

  return new ToolMessage({
    content,
    name,
    ...(status ? { status } : {}),
    tool_call_id: toolCallId
  })
}

export function buildJingleToolResultUpdateCommand<
  TUpdate extends object = Record<string, unknown>
>(input: BuildJingleToolResultUpdateCommandInput<TUpdate>): JingleToolResultUpdateCommand<TUpdate> {
  return new Command({
    update: {
      ...(input.update ?? {}),
      messages: [buildJingleToolResultMessage(input.toolResult)]
    } as JingleToolResultCommandUpdate<TUpdate>
  }) as JingleToolResultUpdateCommand<TUpdate>
}

export function isJingleGraphInterrupt(error: unknown): boolean {
  return isGraphInterrupt(error)
}

export function mapJingleAiMessageToolCalls<TResponse>(
  response: TResponse,
  mapToolCall: JingleAiToolCallMapper
): TResponse {
  if (!AIMessage.isInstance(response) || !response.tool_calls?.length) {
    return response
  }

  return new AIMessage({
    additional_kwargs: response.additional_kwargs,
    content: response.content,
    id: response.id,
    invalid_tool_calls: response.invalid_tool_calls,
    name: response.name,
    response_metadata: response.response_metadata,
    tool_calls: response.tool_calls.map((toolCall) =>
      mapToolCall(toolCall as JingleAiToolCall)
    ) as ToolCall[],
    usage_metadata: response.usage_metadata
  }) as TResponse
}
