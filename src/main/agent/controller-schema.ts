import type {
  AgentCancelParams,
  AgentConnectThreadEventsParams,
  AgentDisconnectThreadEventsParams,
  AgentEditLastUserMessageAndInvokeParams,
  AgentFollowUpQueueItemParams,
  AgentFollowUpQueueMessageParams,
  AgentFollowUpQueueRequestParams,
  AgentInvokeParams,
  AgentResumeParams
} from "../types"
import {
  nonEmptyTrimmedStringSchema,
  optionalNormalizedTrimmedStringSchema
} from "../ipc/schema-primitives"
import { parseIpcPayloadWithSchema, z } from "../ipc/schema"

const composerMessageRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("file"),
      name: nonEmptyTrimmedStringSchema,
      path: nonEmptyTrimmedStringSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      name: optionalNormalizedTrimmedStringSchema,
      url: nonEmptyTrimmedStringSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("extension-source"),
      extensionName: nonEmptyTrimmedStringSchema,
      name: nonEmptyTrimmedStringSchema,
      sourceId: nonEmptyTrimmedStringSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("assistant-message-selection"),
      selectedText: nonEmptyTrimmedStringSchema,
      sourceMessageId: nonEmptyTrimmedStringSchema,
      sourceThreadId: nonEmptyTrimmedStringSchema
    })
    .strict()
])

const agentMessageContentBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z.union([
        nonEmptyTrimmedStringSchema,
        z
          .object({
            detail: z.enum(["auto", "high", "low"]).optional(),
            url: nonEmptyTrimmedStringSchema
          })
          .strict()
      ]),
      mimeType: optionalNormalizedTrimmedStringSchema,
      name: optionalNormalizedTrimmedStringSchema
    })
    .strict()
])

const permissionModeSchema = z.enum(["explore", "ask-to-edit", "auto"])
const followUpActionSchema = z.literal("steer")
const agentThreadEventSubscriptionSurfaceSchema = z.enum(["launcher", "main"])

export const agentInvokeParamsSchema = z
  .object({
    expectedRunId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    expectedTurnId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    threadId: nonEmptyTrimmedStringSchema,
    message: z
      .object({
        content: z.union([z.string(), z.array(agentMessageContentBlockSchema)]),
        id: nonEmptyTrimmedStringSchema,
        refs: z.array(composerMessageRefSchema).optional()
      })
      .strict(),
    modelId: optionalNormalizedTrimmedStringSchema,
    permissionMode: permissionModeSchema.optional(),
    temporaryMode: z.boolean().optional(),
    followUpAction: followUpActionSchema.optional()
  })
  .strict()

const hitlDecisionSchema = z
  .object({
    feedback: optionalNormalizedTrimmedStringSchema,
    request_id: nonEmptyTrimmedStringSchema,
    tool_call_id: nonEmptyTrimmedStringSchema,
    type: z.enum(["approve", "reject"])
  })
  .strict()

export const agentResumeParamsSchema = z
  .object({
    decision: hitlDecisionSchema,
    modelId: optionalNormalizedTrimmedStringSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentCancelParamsSchema = z
  .object({
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentConnectThreadEventsParamsSchema = z
  .object({
    fromRevision: z.number().int().nonnegative().optional(),
    surface: agentThreadEventSubscriptionSurfaceSchema.optional(),
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentDisconnectThreadEventsParamsSchema = z
  .object({
    subscriptionToken: nonEmptyTrimmedStringSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

const composerMessageInputSchema = z
  .object({
    refs: z.array(composerMessageRefSchema),
    text: z.string()
  })
  .strict()

const followUpQueueItemSchema = z
  .object({
    messageInput: composerMessageInputSchema,
    requestId: nonEmptyTrimmedStringSchema,
    text: z.string()
  })
  .strict()

export const agentFollowUpQueueMessageParamsSchema = z
  .object({
    messageInput: composerMessageInputSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentFollowUpQueueRequestParamsSchema = z
  .object({
    requestId: nonEmptyTrimmedStringSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentSteerFollowUpParamsSchema = z
  .object({
    expectedRunId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    expectedTurnId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    requestId: nonEmptyTrimmedStringSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentFollowUpQueueItemParamsSchema = z
  .object({
    item: followUpQueueItemSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export function parseAgentInvokeParams(value: unknown): AgentInvokeParams {
  return parseIpcPayloadWithSchema("agent:invoke", agentInvokeParamsSchema, value)
}

export function parseAgentEditLastUserMessageAndInvokeParams(
  value: unknown
): AgentEditLastUserMessageAndInvokeParams {
  return parseIpcPayloadWithSchema(
    "agent:editLastUserMessageAndInvoke",
    agentInvokeParamsSchema,
    value
  )
}

export function parseAgentResumeParams(value: unknown): AgentResumeParams {
  return parseIpcPayloadWithSchema("agent:resume", agentResumeParamsSchema, value)
}

export function parseAgentCancelParams(value: unknown): AgentCancelParams {
  return parseIpcPayloadWithSchema("agent:cancel", agentCancelParamsSchema, value)
}

export function parseAgentConnectThreadEventsParams(
  value: unknown
): AgentConnectThreadEventsParams {
  return parseIpcPayloadWithSchema(
    "agent:connectThreadEvents",
    agentConnectThreadEventsParamsSchema,
    value
  )
}

export function parseAgentDisconnectThreadEventsParams(
  value: unknown
): AgentDisconnectThreadEventsParams {
  return parseIpcPayloadWithSchema(
    "agent:disconnectThreadEvents",
    agentDisconnectThreadEventsParamsSchema,
    value
  )
}

export function parseAgentFollowUpQueueMessageParams(
  channel: string,
  value: unknown
): AgentFollowUpQueueMessageParams {
  return parseIpcPayloadWithSchema(channel, agentFollowUpQueueMessageParamsSchema, value)
}

export function parseAgentFollowUpQueueRequestParams(
  channel: string,
  value: unknown
): AgentFollowUpQueueRequestParams {
  return parseIpcPayloadWithSchema(channel, agentFollowUpQueueRequestParamsSchema, value)
}

export function parseAgentSteerFollowUpParams(value: unknown): AgentFollowUpQueueRequestParams {
  return parseIpcPayloadWithSchema("agent:steerFollowUp", agentSteerFollowUpParamsSchema, value)
}

export function parseAgentFollowUpQueueItemParams(
  channel: string,
  value: unknown
): AgentFollowUpQueueItemParams {
  return parseIpcPayloadWithSchema(channel, agentFollowUpQueueItemParamsSchema, value)
}
