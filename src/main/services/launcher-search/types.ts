import type {
  LauncherSearchRequest,
  LauncherSearchResult,
  LauncherSearchSource
} from "@shared/launcher-search"

export type LauncherSearchProviderResponse =
  | {
      kind: "complete"
      results: LauncherSearchResult[]
    }
  | {
      kind: "partial"
      results: LauncherSearchResult[]
    }

export interface LauncherSearchProviderContext {
  signal: AbortSignal
}

export interface LauncherSearchProvider {
  source: LauncherSearchSource
  search: (
    request: LauncherSearchRequest,
    context: LauncherSearchProviderContext
  ) => Promise<LauncherSearchProviderResponse>
  invalidate?: () => void
  warmup?: (context: LauncherSearchProviderContext) => Promise<void>
}
