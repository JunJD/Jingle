import type {
  LauncherSearchDiagnostic,
  LauncherSearchRequest,
  LauncherSearchResult,
  LauncherSearchSource
} from "../../../shared/launcher-search"

export interface LauncherSearchProviderResponse {
  diagnostic: LauncherSearchDiagnostic
  results: LauncherSearchResult[]
}

export interface LauncherSearchProvider {
  source: LauncherSearchSource
  search: (request: LauncherSearchRequest) => Promise<LauncherSearchProviderResponse>
  warmup?: () => Promise<void>
}
