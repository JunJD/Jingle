export const THREAD_DIGEST_STATUSES = ["pending", "ready", "failed"] as const

export type ThreadDigestStatus = (typeof THREAD_DIGEST_STATUSES)[number]

export interface ThreadDigestRecord {
  decisions: string[]
  generatedAt: number | null
  messageCount: number
  openQuestions: string[]
  projectedThroughSeq: number
  projectionError: string | null
  sourceHash: string | null
  status: ThreadDigestStatus
  summary: string | null
  threadId: string
  topics: string[]
  updatedAt: number
}

export interface ThreadDigestSearchMatch extends ThreadDigestRecord {
  rank: number
  searchText: string | null
  threadTitle: string | null
  threadUpdatedAt: number
}
