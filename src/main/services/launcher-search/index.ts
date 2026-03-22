import type { LauncherSearchRequest, LauncherSearchResponse } from "../../../shared/launcher-search"
import { applicationsLauncherSearchProvider } from "./providers/applications"
import type { LauncherSearchProvider } from "./types"

const providers: LauncherSearchProvider[] = [applicationsLauncherSearchProvider]
const providerOrder = new Map(providers.map((provider, index) => [provider.source, index]))

function getSelectedProviders(request: LauncherSearchRequest): LauncherSearchProvider[] {
  if (!request.sources?.length) {
    return providers
  }

  const selectedSources = new Set(request.sources)
  return providers.filter((provider) => selectedSources.has(provider.source))
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
  const selectedProviders = getSelectedProviders(normalizedRequest)

  if (selectedProviders.length === 0) {
    return {
      diagnostics: [],
      query: normalizedRequest.query,
      results: []
    }
  }

  const providerResponses = await Promise.all(
    selectedProviders.map((provider) => provider.search(normalizedRequest))
  )

  const results = providerResponses
    .flatMap((response) => response.results)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftOrder = providerOrder.get(left.source) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = providerOrder.get(right.source) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.title.localeCompare(right.title)
    })
    .slice(0, normalizedRequest.limit)

  return {
    diagnostics: providerResponses.map((response) => response.diagnostic),
    query: normalizedRequest.query,
    results
  }
}
