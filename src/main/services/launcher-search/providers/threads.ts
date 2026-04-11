import type { LauncherSearchRequest } from "../../../../shared/launcher-search"
import {
  searchThreadMatches,
  type ThreadSearchDirectMatchRow,
  type ThreadSearchMessageMatchRow
} from "../../../db"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"

interface RankedThreadSearchRow {
  excerpt: string | null
  score: number
  thread_id: string
  title: string | null
  updated_at: number
}

function buildMessagesFtsQuery(query: string): string | null {
  const terms = Array.from(query.matchAll(/[\p{L}\p{N}_]+/gu))
    .map((match) => match[0])
    .filter(Boolean)

  if (terms.length === 0) {
    return null
  }

  return terms.map((term) => `${term}*`).join(" ")
}

function toSearchExcerpt(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return null
  }

  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized
}

function buildSubtitle(params: { excerpt: string | null; threadId: string }): string {
  const excerpt = toSearchExcerpt(params.excerpt)
  if (!excerpt) {
    return `Thread · ${params.threadId}`
  }

  return excerpt
}

function scoreDirectMatch(row: ThreadSearchDirectMatchRow, loweredQuery: string): number {
  const threadId = row.thread_id.toLowerCase()
  const title = row.title?.toLowerCase() ?? ""

  if (threadId === loweredQuery) {
    return 900
  }

  if (threadId.startsWith(loweredQuery)) {
    return 780
  }

  if (title.startsWith(loweredQuery)) {
    return 720
  }

  if (title.includes(loweredQuery)) {
    return 640
  }

  return 560
}

function rankThreadMatches(params: {
  directRows: ThreadSearchDirectMatchRow[]
  limit: number
  messageRows: ThreadSearchMessageMatchRow[]
  query: string
}): RankedThreadSearchRow[] {
  const { directRows, limit, messageRows, query } = params
  const loweredQuery = query.toLowerCase()
  const rowsByThreadId = new Map<string, RankedThreadSearchRow>()

  for (const row of directRows) {
    rowsByThreadId.set(row.thread_id, {
      excerpt: null,
      score: scoreDirectMatch(row, loweredQuery),
      thread_id: row.thread_id,
      title: row.title,
      updated_at: row.updated_at
    })
  }

  messageRows.forEach((row, index) => {
    const existing = rowsByThreadId.get(row.thread_id)
    const messageScore = 520 - index

    if (existing) {
      rowsByThreadId.set(row.thread_id, {
        ...existing,
        excerpt: existing.excerpt ?? row.search_text,
        score: Math.max(existing.score, messageScore)
      })
      return
    }

    rowsByThreadId.set(row.thread_id, {
      excerpt: row.search_text,
      score: messageScore,
      thread_id: row.thread_id,
      title: row.title,
      updated_at: row.updated_at
    })
  })

  return Array.from(rowsByThreadId.values())
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.updated_at - left.updated_at
    })
    .slice(0, limit)
}

class ThreadsLauncherSearchProvider implements LauncherSearchProvider {
  readonly source = "threads" as const

  async search(request: LauncherSearchRequest): Promise<LauncherSearchProviderResponse> {
    const query = request.query.trim()
    if (!query) {
      return { results: [] }
    }

    const limit = Math.min(Math.max(request.limit, 1), 50)
    const matches = await searchThreadMatches({
      directLimit: limit,
      ftsQuery: buildMessagesFtsQuery(query),
      messageLimit: limit * 4,
      query
    })
    const rows = rankThreadMatches({
      directRows: matches.direct,
      limit,
      messageRows: matches.messages,
      query
    })

    return {
      results: rows.map((row) => ({
        action: {
          executor: "internal",
          target: {
            threadId: row.thread_id
          },
          type: "open-history-thread"
        },
        id: row.thread_id,
        kind: "history",
        score: row.score,
        source: "threads",
        subtitle: buildSubtitle({
          excerpt: row.excerpt,
          threadId: row.thread_id
        }),
        title: row.title ?? "Untitled thread"
      }))
    }
  }
}

export const threadsLauncherSearchProvider = new ThreadsLauncherSearchProvider()
