import { getEnvValue } from "../../storage"
import { getTavilyClient, toTavilyTimeoutSeconds } from "./tavily"
import type { WebSearchResponse, WebSearchResult } from "./types"
import { normalizePublicHttpUrl } from "./url-guard"

const DEFAULT_MAX_RESULTS = 5
const MAX_MAX_RESULTS = 10
const MAX_QUERY_LENGTH = 400
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_SNIPPET_LENGTH = 320

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getConfiguredMaxResults(): number {
  const raw = Number(getEnvValue("OPENWORK_WEB_SEARCH_MAX_RESULTS"))
  if (!Number.isFinite(raw)) {
    return DEFAULT_MAX_RESULTS
  }

  return clamp(Math.floor(raw), 1, MAX_MAX_RESULTS)
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH)
}

function truncateSnippet(value: string): string {
  if (value.length <= MAX_SNIPPET_LENGTH) {
    return value
  }

  return `${value.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`
}

function createEmptySearchResponse(query: string): WebSearchResponse {
  return {
    provider: "tavily",
    query,
    results: [],
    totalResults: 0
  }
}

export async function searchWeb(query: string): Promise<WebSearchResponse> {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return createEmptySearchResponse("")
  }

  const client = getTavilyClient()
  if (!client) {
    return createEmptySearchResponse(normalizedQuery)
  }

  try {
    const payload = await client.search(normalizedQuery, {
      includeAnswer: false,
      includeImages: false,
      includeRawContent: false,
      maxResults: getConfiguredMaxResults(),
      searchDepth: "advanced",
      timeout: toTavilyTimeoutSeconds(DEFAULT_TIMEOUT_MS)
    })

    const results: WebSearchResult[] = []
    for (const result of payload.results ?? []) {
      const title = result.title.trim()
      const url = normalizePublicHttpUrl(result.url)
      if (!title || !url) {
        continue
      }

      results.push({
        snippet: truncateSnippet(result.content.trim()),
        title,
        url
      })
    }

    return {
      provider: "tavily",
      query: normalizedQuery,
      results,
      totalResults: results.length
    }
  } catch (error) {
    console.warn("[WebTools] Tavily search failed.", error)
    return createEmptySearchResponse(normalizedQuery)
  }
}
