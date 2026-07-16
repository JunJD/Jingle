import type { ZodType } from "zod/v4"
import {
  MODEL_SETUP_IPC_CHANNELS,
  type ModelSetupIpcArgs,
  type ModelSetupIpcChannel
} from "@shared/model-setup"
import { z } from "../ipc/schema"
import { nonEmptyTrimmedStringSchema } from "../ipc/schema-primitives"
import type {
  SetDefaultModelParams,
  SetProviderCredentialsParams,
  UpsertCustomProviderParams
} from "../types"

const providerIdArgsSchema = z.tuple([nonEmptyTrimmedStringSchema])
const thinkingEffortValueSchema = z.enum(["off", "low", "medium", "high", "xhigh", "max"])
const thinkingEffortSchema = thinkingEffortValueSchema.nullable()

const customProviderModelSchema = z.union([
  nonEmptyTrimmedStringSchema,
  z
    .object({
      name: nonEmptyTrimmedStringSchema,
      reasoningEfforts: z.array(thinkingEffortValueSchema).min(1).optional()
    })
    .strict()
])

const modelSelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("listed"),
      modelId: nonEmptyTrimmedStringSchema,
      thinkingEffort: thinkingEffortSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("unlisted"),
      modelName: nonEmptyTrimmedStringSchema,
      providerId: nonEmptyTrimmedStringSchema,
      thinkingEffort: thinkingEffortSchema
    })
    .strict()
])

const customProviderInputSchema = z
  .object({
    apiKey: z.string().optional(),
    basePath: z.string().optional(),
    baseUrl: z.string().optional(),
    description: z.string().optional(),
    displayName: z.string(),
    engine: z.enum(["openai", "anthropic", "ollama"]),
    headers: z.record(z.string(), z.string()).optional(),
    models: z.array(customProviderModelSchema),
    providerId: nonEmptyTrimmedStringSchema.optional(),
    requiresAuth: z.boolean(),
    supportsStreaming: z.boolean()
  })
  .strict()

const providerCredentialsParamsSchema = z
  .object({
    credentials: z.record(z.string(), z.string()),
    provider: nonEmptyTrimmedStringSchema
  })
  .strict()

export const legacyModelMutationIpcArgsSchemas = {
  deleteCredentials: providerIdArgsSchema,
  setCredentials: z.tuple([providerCredentialsParamsSchema]) satisfies ZodType<
    [SetProviderCredentialsParams]
  >,
  setDefault: z.tuple([
    z
      .object({
        modelId: nonEmptyTrimmedStringSchema,
        modelType: z.literal("llm"),
        options: z
          .object({
            allowUnlisted: z.boolean().optional(),
            thinkingEffort: thinkingEffortSchema.optional()
          })
          .strict()
          .optional()
      })
      .strict()
  ]) satisfies ZodType<[SetDefaultModelParams]>,
  upsertCustomProvider: z.tuple([
    z.object({ provider: customProviderInputSchema }).strict()
  ]) satisfies ZodType<[UpsertCustomProviderParams]>
}

type ModelSetupIpcSchemaMap = {
  [TChannel in ModelSetupIpcChannel]: ZodType<ModelSetupIpcArgs<TChannel>>
}

export const modelSetupIpcArgsSchemas = {
  [MODEL_SETUP_IPC_CHANNELS.activateProvider]: providerIdArgsSchema,
  [MODEL_SETUP_IPC_CHANNELS.getSnapshot]: z.tuple([]),
  [MODEL_SETUP_IPC_CHANNELS.listProviderModels]: providerIdArgsSchema,
  [MODEL_SETUP_IPC_CHANNELS.resolveUnlistedModel]: z.tuple([
    nonEmptyTrimmedStringSchema,
    nonEmptyTrimmedStringSchema
  ]),
  [MODEL_SETUP_IPC_CHANNELS.selectModel]: z.tuple([modelSelectionSchema])
} satisfies ModelSetupIpcSchemaMap
