import type {
  LauncherSearchRequest,
  LauncherSearchResult,
  LauncherSearchSource
} from "@shared/launcher-search"

export interface LauncherSearchProviderResponse {
  results: LauncherSearchResult[]
}

export interface LauncherSearchProvider {
  source: LauncherSearchSource
  search: (request: LauncherSearchRequest) => Promise<LauncherSearchProviderResponse>
  warmup?: () => Promise<void>
}
