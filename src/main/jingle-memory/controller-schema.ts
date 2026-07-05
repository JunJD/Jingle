import {
  JINGLE_MEMORY_SCOPES,
  JINGLE_MEMORY_STATUSES,
  JINGLE_MEMORY_SUGGESTION_STATUSES,
  JINGLE_MEMORY_TYPES
} from "@shared/jingle-memory"
import {
  nonEmptyTrimmedStringSchema,
  optionalNormalizedTrimmedStringSchema
} from "../ipc/schema-primitives"
import { z } from "../ipc/schema"

const memoryTypeSchema = z.enum(JINGLE_MEMORY_TYPES)
const memoryScopeSchema = z.enum(JINGLE_MEMORY_SCOPES)
const memoryStatusSchema = z.enum(JINGLE_MEMORY_STATUSES)
const suggestionStatusSchema = z.enum(JINGLE_MEMORY_SUGGESTION_STATUSES)
const jsonRecordSchema = z.record(z.string(), z.unknown())

const listMemoriesParamsSchema = z
  .object({
    query: optionalNormalizedTrimmedStringSchema,
    scope: memoryScopeSchema.optional(),
    status: memoryStatusSchema.optional(),
    type: memoryTypeSchema.optional()
  })
  .strict()

const listSuggestionsParamsSchema = z
  .object({
    scope: memoryScopeSchema.optional(),
    status: suggestionStatusSchema.optional(),
    threadId: optionalNormalizedTrimmedStringSchema
  })
  .strict()

const createSuggestionParamsSchema = z
  .object({
    content: nonEmptyTrimmedStringSchema,
    reason: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    reviewPayload: jsonRecordSchema.nullable().optional(),
    scope: memoryScopeSchema,
    sourceRunId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    threadId: optionalNormalizedTrimmedStringSchema.nullable().optional(),
    type: memoryTypeSchema
  })
  .strict()

const createMemoryParamsSchema = z
  .object({
    content: nonEmptyTrimmedStringSchema,
    metadata: jsonRecordSchema.nullable().optional(),
    scope: memoryScopeSchema,
    type: memoryTypeSchema
  })
  .strict()

const settingsUpdateSchema = z
  .object({
    askBeforeSaving: z.boolean().optional(),
    showIncludedMemories: z.boolean().optional(),
    useMemory: z.boolean().optional()
  })
  .strict()

export const setSettingsArgsSchema = z.tuple([settingsUpdateSchema.optional()]).or(z.tuple([]))
export const getSettingsArgsSchema = z.tuple([])
export const getCurrentWorkspaceIdentityArgsSchema = z.tuple([])
export const listMemoriesArgsSchema = z.tuple([listMemoriesParamsSchema.optional()]).or(z.tuple([]))
export const listSuggestionsArgsSchema = z
  .tuple([listSuggestionsParamsSchema.optional()])
  .or(z.tuple([]))
export const createMemoryArgsSchema = z.tuple([createMemoryParamsSchema])
export const createSuggestionArgsSchema = z.tuple([createSuggestionParamsSchema])

export const acceptSuggestionArgsSchema = z.tuple([
  nonEmptyTrimmedStringSchema,
  z
    .object({
      content: optionalNormalizedTrimmedStringSchema,
      scope: memoryScopeSchema.optional(),
      type: memoryTypeSchema.optional()
    })
    .strict()
    .optional()
])

export const updateMemoryArgsSchema = z.tuple([
  nonEmptyTrimmedStringSchema,
  z
    .object({
      content: optionalNormalizedTrimmedStringSchema,
      scope: memoryScopeSchema.optional(),
      type: memoryTypeSchema.optional()
    })
    .strict()
])

export const memoryIdArgsSchema = z.tuple([nonEmptyTrimmedStringSchema])
export const runIdArgsSchema = z.tuple([nonEmptyTrimmedStringSchema])
export const threadIdArgsSchema = z.tuple([nonEmptyTrimmedStringSchema])
export const listContextSourcesArgsSchema = z.tuple([])
