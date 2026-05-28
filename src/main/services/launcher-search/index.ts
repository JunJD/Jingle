import type { LauncherSearchRequest, LauncherSearchResponse } from "@shared/launcher-search"
import { applicationsLauncherSearchProvider } from "./providers/applications"
import { browserHistoryLauncherSearchProvider } from "./providers/browser-history"
import { filesLauncherSearchProvider } from "./providers/files"
import { quicklinksLauncherSearchProvider } from "./providers/quicklinks"
import { threadsLauncherSearchProvider } from "./providers/threads"
import type { LauncherSearchProvider } from "./types"

const providers: LauncherSearchProvider[] = [
  applicationsLauncherSearchProvider,
  quicklinksLauncherSearchProvider,
  threadsLauncherSearchProvider,
  filesLauncherSearchProvider,
  browserHistoryLauncherSearchProvider
]
const providerOrder = new Map(providers.map((provider, index) => [provider.source, index]))
const LAUNCHER_SEARCH_CACHE_TTL_MS = 1500
const searchResponseCache = new Map<
  string,
  { expiresAt: number; response: LauncherSearchResponse }
>()
const inflightSearches = new Map<string, Promise<LauncherSearchResponse>>()

function dedupeSearchResults<T extends { result: { id: string; source: string } }>(
  entries: T[]
): T[] {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = `${entry.result.source}:${entry.result.id}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function getSelectedProviders(request: LauncherSearchRequest): LauncherSearchProvider[] {
  if (!request.sources?.length) {
    return providers
  }

  const selectedSources = new Set(request.sources)
  return providers.filter((provider) => selectedSources.has(provider.source))
}

function getSearchRequestCacheKey(request: LauncherSearchRequest): string {
  const sources = request.sources?.length ? [...request.sources].sort().join(",") : "all"
  return `${sources}\u0000${request.limit}\u0000${request.query.trim()}`
}

function getCachedSearchResponse(cacheKey: string): LauncherSearchResponse | null {
  const cached = searchResponseCache.get(cacheKey)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    searchResponseCache.delete(cacheKey)
    return null
  }

  return cached.response
}

export async function warmLauncherSearchProviders(): Promise<void> {
  await Promise.all(
    providers.map(async (provider) => {
      if (provider.warmup) {
        await provider.warmup()
      }
    })
  )
}

export async function searchLauncher(
  request: LauncherSearchRequest
): Promise<LauncherSearchResponse> {
  const normalizedRequest: LauncherSearchRequest = {
    ...request,
    limit: Math.max(request.limit, 1)
  }
  const cacheKey = getSearchRequestCacheKey(normalizedRequest)
  const cachedResponse = getCachedSearchResponse(cacheKey)
  if (cachedResponse) {
    return cachedResponse
  }

  const inflightSearch = inflightSearches.get(cacheKey)
  if (inflightSearch) {
    return inflightSearch
  }

  const searchPromise = (async (): Promise<LauncherSearchResponse> => {
    const selectedProviders = getSelectedProviders(normalizedRequest)

    if (selectedProviders.length === 0) {
      return {
        query: normalizedRequest.query,
        results: []
      }
    }

    const providerResponses = await Promise.allSettled(
      selectedProviders.map((provider) => provider.search(normalizedRequest))
    )

    const sortedEntries = providerResponses
      .flatMap((providerResponse, providerResponseIndex) => {
        if (providerResponse.status === "rejected") {
          const provider = selectedProviders[providerResponseIndex]
          console.warn(`[LauncherSearch] Provider "${provider?.source ?? "unknown"}" failed:`, {
            error:
              providerResponse.reason instanceof Error
                ? providerResponse.reason.message
                : String(providerResponse.reason)
          })
          return []
        }

        return providerResponse.value.results.map((result, resultIndex) => ({
          providerResponseIndex,
          result,
          resultIndex
        }))
      })
      .sort((left, right) => {
        if (right.result.score !== left.result.score) {
          return right.result.score - left.result.score
        }

        const leftOrder = providerOrder.get(left.result.source) ?? Number.MAX_SAFE_INTEGER
        const rightOrder = providerOrder.get(right.result.source) ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder
        }

        if (left.providerResponseIndex !== right.providerResponseIndex) {
          return left.providerResponseIndex - right.providerResponseIndex
        }

        return left.resultIndex - right.resultIndex
      })
    const results = dedupeSearchResults(sortedEntries)
      .slice(0, normalizedRequest.limit)
      .map((entry) => entry.result)

    return {
      query: normalizedRequest.query,
      results
    }
  })()

  inflightSearches.set(cacheKey, searchPromise)

  try {
    const response = await searchPromise
    searchResponseCache.set(cacheKey, {
      expiresAt: Date.now() + LAUNCHER_SEARCH_CACHE_TTL_MS,
      response
    })
    return response
  } finally {
    inflightSearches.delete(cacheKey)
  }
}
