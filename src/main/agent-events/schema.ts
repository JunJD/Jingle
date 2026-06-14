import { z } from "../ipc/schema"

const nullableStringSchema = z.string().nullable()
const optionalNullableStringSchema = nullableStringSchema.optional()
const jsonRecordSchema = z.record(z.string(), z.unknown())

export const agentEventTypeSchema = z.enum([
  "approval.requested",
  "approval.resolved",
  "checkpoint.committed",
  "llm.input.captured",
  "llm.output.captured",
  "message.assistant.completed",
  "message.assistant.started",
  "message.user.created",
  "run.finished",
  "run.interrupted",
  "run.resumed",
  "run.started",
  "tool.call.completed",
  "tool.call.failed",
  "tool.call.started"
])

const eventPayloadSchemas = {
  "approval.requested": z
    .object({
      allowedDecisions: z.array(z.string()),
      requestId: z.string(),
      review: z.unknown().nullable(),
      toolArgs: z.unknown(),
      toolCallId: z.string(),
      toolName: z.string()
    })
    .strict(),
  "approval.resolved": z
    .object({
      decision: z.string(),
      feedback: optionalNullableStringSchema,
      requestId: z.string(),
      toolCallId: optionalNullableStringSchema
    })
    .strict(),
  "checkpoint.committed": z
    .object({
      checkpointId: z.string(),
      checkpointNs: z.string(),
      metadataSource: optionalNullableStringSchema,
      step: z.unknown().nullable()
    })
    .strict(),
  "llm.input.captured": z
    .object({
      context: z.unknown().optional(),
      contextSnapshot: z.unknown().optional(),
      extraParams: jsonRecordSchema,
      input: z.unknown(),
      llmRunId: z.string(),
      messagesBaseline: z.array(z.unknown()),
      messagesDelta: z.array(z.unknown()).optional(),
      model: optionalNullableStringSchema,
      provider: optionalNullableStringSchema,
      runName: optionalNullableStringSchema,
      toolSchema: z.unknown().optional()
    })
    .strict(),
  "llm.output.captured": z
    .object({
      errorMessage: optionalNullableStringSchema,
      errorType: optionalNullableStringSchema,
      inputTokens: z.number().optional(),
      llmRunId: z.string(),
      model: optionalNullableStringSchema,
      output: z.unknown().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional()
    })
    .strict(),
  "message.assistant.completed": z
    .object({
      contentLength: z.number(),
      messageId: z.string(),
      model: optionalNullableStringSchema
    })
    .strict(),
  "message.assistant.started": z
    .object({
      messageId: z.string(),
      model: optionalNullableStringSchema
    })
    .strict(),
  "message.user.created": z
    .object({
      contentPreview: z.string(),
      refs: z.array(z.unknown()),
      userMessageId: z.string()
    })
    .strict(),
  "run.finished": z
    .object({
      completionReason: optionalNullableStringSchema,
      errorMessage: optionalNullableStringSchema,
      errorType: optionalNullableStringSchema,
      status: z.string()
    })
    .strict(),
  "run.interrupted": z
    .object({
      status: z.string()
    })
    .strict(),
  "run.resumed": z
    .object({
      model: optionalNullableStringSchema,
      requestId: z.string(),
      source: z.literal("resume")
    })
    .strict(),
  "run.started": z
    .object({
      model: optionalNullableStringSchema,
      permissionMode: z.string(),
      source: z.literal("invoke"),
      userMessageId: z.string()
    })
    .strict(),
  "tool.call.completed": z
    .object({
      messageId: z.string(),
      output: z.unknown(),
      status: z.literal("completed"),
      toolCallId: z.string(),
      toolName: optionalNullableStringSchema
    })
    .strict(),
  "tool.call.failed": z
    .object({
      messageId: z.string(),
      output: z.unknown(),
      status: z.literal("failed"),
      toolCallId: z.string(),
      toolName: optionalNullableStringSchema
    })
    .strict(),
  "tool.call.started": z
    .object({
      args: z.unknown().nullable(),
      messageId: z.string(),
      toolCallId: z.string(),
      toolName: optionalNullableStringSchema
    })
    .strict()
} as const

export type AgentEventType = z.infer<typeof agentEventTypeSchema>
export type AgentEventPayloadByType = {
  [TType in keyof typeof eventPayloadSchemas]: z.infer<(typeof eventPayloadSchemas)[TType]>
}
export type AgentEventPayload = AgentEventPayloadByType[AgentEventType]

export function parseAgentEventType(type: string): AgentEventType {
  return agentEventTypeSchema.parse(type)
}

export function parseAgentEventPayload<TType extends AgentEventType>(
  type: TType,
  payload: unknown
): AgentEventPayloadByType[TType] {
  return eventPayloadSchemas[type].parse(payload) as AgentEventPayloadByType[TType]
}

export function parseAgentEventPayloadFromJson(type: string, payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("[AgentEventSchema] Event payload must be a JSON object.")
  }

  const eventType = parseAgentEventType(type)
  return parseAgentEventPayload(eventType, parsed) as Record<string, unknown>
}

export function normalizeAgentEventPayload(type: string, payload: unknown): Record<string, unknown> {
  const eventType = parseAgentEventType(type)
  return parseAgentEventPayload(eventType, payload ?? {}) as Record<string, unknown>
}
