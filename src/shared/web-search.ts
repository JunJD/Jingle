export type WebSearchProviderId = "tavily"

export interface WebSearchResult {
  readonly snippet: string
  readonly title: string
  readonly url: string
}

export interface WebSearchResponse {
  readonly provider: WebSearchProviderId
  readonly query: string
  readonly results: readonly WebSearchResult[]
  readonly totalResults: number
}

const MAX_WEB_SEARCH_QUERY_LENGTH = 400

export function normalizeWebSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, MAX_WEB_SEARCH_QUERY_LENGTH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isWebSearchResult(value: unknown): value is WebSearchResult {
  return (
    isRecord(value) &&
    typeof value.snippet === "string" &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.url === "string" &&
    value.url.trim().length > 0
  )
}

export function parseWebSearchResponse(value: unknown): WebSearchResponse | null {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return null
  }

  if (
    parsed.provider !== "tavily" ||
    typeof parsed.query !== "string" ||
    !Number.isSafeInteger(parsed.totalResults) ||
    (parsed.totalResults as number) < 0 ||
    !parsed.results.every(isWebSearchResult)
  ) {
    return null
  }

  return {
    provider: "tavily",
    query: parsed.query,
    results: parsed.results.map((result) => ({
      snippet: result.snippet,
      title: result.title,
      url: result.url
    })),
    totalResults: parsed.totalResults as number
  }
}

export function parseWebSearchResponseForQuery(
  value: unknown,
  requestQuery: string
): WebSearchResponse | null {
  const response = parseWebSearchResponse(value)
  const normalizedQuery = normalizeWebSearchQuery(requestQuery)
  return normalizedQuery && response?.query === normalizedQuery ? response : null
}
