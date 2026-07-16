import { z } from "zod/v4"

export const THREAD_DIGEST_STATUSES = ["pending", "ready", "failed"] as const

export const threadDigestStatusSchema = z.enum(THREAD_DIGEST_STATUSES)
export type ThreadDigestStatus = z.infer<typeof threadDigestStatusSchema>

export const threadDigestRecordSchema = z
  .object({
    decisions: z.array(z.string()),
    generatedAt: z.int().nonnegative().nullable(),
    messageCount: z.int().nonnegative(),
    openQuestions: z.array(z.string()),
    projectedThroughSeq: z.int().nonnegative(),
    projectionError: z.string().nullable(),
    sourceHash: z.string().nullable(),
    status: threadDigestStatusSchema,
    summary: z.string().nullable(),
    threadId: z.string().min(1),
    topics: z.array(z.string()),
    updatedAt: z.int().nonnegative()
  })
  .strict()

export type ThreadDigestRecord = z.infer<typeof threadDigestRecordSchema>

export interface ThreadDigestSearchMatch extends ThreadDigestRecord {
  rank: number
  searchText: string | null
  threadTitle: string | null
  threadUpdatedAt: number
}

export const threadDigestRequestSchema = z
  .object({
    threadId: z.string().trim().min(1)
  })
  .strict()

export type ThreadDigestRequest = z.infer<typeof threadDigestRequestSchema>

export const threadDigestChangedEventSchema = z
  .object({
    digest: threadDigestRecordSchema
  })
  .strict()

export type ThreadDigestChangedEvent = z.infer<typeof threadDigestChangedEventSchema>
