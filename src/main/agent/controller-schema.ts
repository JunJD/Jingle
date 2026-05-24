import type { AgentCancelParams, AgentInvokeParams, AgentResumeParams } from "../types"
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
      ])
    })
    .strict()
])

const permissionModeSchema = z.enum(["explore", "ask-to-edit", "auto"])

export const agentInvokeParamsSchema = z
  .object({
    threadId: nonEmptyTrimmedStringSchema,
    message: z
      .object({
        additional_kwargs: z
          .object({
            refs: z.array(composerMessageRefSchema).optional()
          })
          .strict()
          .optional(),
        content: z.union([z.string(), z.array(agentMessageContentBlockSchema)]),
        id: nonEmptyTrimmedStringSchema
      })
      .strict(),
    modelId: optionalNormalizedTrimmedStringSchema,
    permissionMode: permissionModeSchema.optional(),
    temporaryMode: z.boolean().optional()
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
    command: z
      .object({
        resume: hitlDecisionSchema
      })
      .strict(),
    modelId: optionalNormalizedTrimmedStringSchema,
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export const agentCancelParamsSchema = z
  .object({
    threadId: nonEmptyTrimmedStringSchema
  })
  .strict()

export function parseAgentInvokeParams(value: unknown): AgentInvokeParams {
  return parseIpcPayloadWithSchema("agent:invoke", agentInvokeParamsSchema, value)
}

export function parseAgentResumeParams(value: unknown): AgentResumeParams {
  return parseIpcPayloadWithSchema("agent:resume", agentResumeParamsSchema, value)
}

export function parseAgentCancelParams(value: unknown): AgentCancelParams {
  return parseIpcPayloadWithSchema("agent:cancel", agentCancelParamsSchema, value)
}
