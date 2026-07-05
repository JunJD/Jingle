import type {
  AgentCancelParams,
  AgentConnectThreadEventsParams,
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
const agentThreadEventSubscriptionSurfaceSchema = z.enum(["launcher", "pinned-ai-session"])

export const agentInvokeParamsSchema = z
  .object({
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
    tool_call_id: optionalNormalizedTrimmedStringSchema,
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
    surface: agentThreadEventSubscriptionSurfaceSchema.default("launcher"),
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

export function parseAgentFollowUpQueueItemParams(
  channel: string,
  value: unknown
): AgentFollowUpQueueItemParams {
  return parseIpcPayloadWithSchema(channel, agentFollowUpQueueItemParamsSchema, value)
}
