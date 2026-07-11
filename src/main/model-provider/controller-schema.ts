import type { ZodType } from "zod/v4"
import { z } from "../ipc/schema"
import { nonEmptyTrimmedStringSchema } from "../ipc/schema-primitives"
import type {
  SetDefaultModelParams,
  SetProviderCredentialsParams,
  UpsertCustomProviderParams
} from "../types"

const providerIdArgsSchema = z.tuple([nonEmptyTrimmedStringSchema])
const thinkingEffortSchema = z.enum(["off", "low", "medium", "high", "max"]).nullable()

const customProviderInputSchema = z
  .object({
    apiKey: z.string().optional(),
    basePath: z.string().optional(),
    baseUrl: z.string().optional(),
    description: z.string().optional(),
    displayName: z.string(),
    engine: z.enum(["openai", "anthropic", "ollama"]),
    headers: z.record(z.string(), z.string()).optional(),
    models: z.array(z.string()),
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
