import { sortLauncherHistoryItems, type LauncherHistoryItem } from "@shared/launcher-history"
import type { LauncherSearchResult, LauncherSearchSource } from "@shared/launcher-search"
import type { LauncherWindowMode } from "@shared/launcher-settings"
import type { LocalStartItem } from "@shared/local-start"

export const LAUNCHER_SEARCH_SOURCES: readonly LauncherSearchSource[] = [
  "applications",
  "quicklinks",
  "files",
  "threads",
  "browser-history"
]
const launcherSearchSourceSet = new Set<LauncherSearchSource>(LAUNCHER_SEARCH_SOURCES)

export const launcherSearchSourceOrder = new Map(
  LAUNCHER_SEARCH_SOURCES.map((source, index) => [source, index])
)
const MAX_VISIBLE_THREAD_SEARCH_RESULTS = 3

export interface LauncherSearchState {
  query: string
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
}

export interface LauncherSearchPageStoreState {
  applyIdleState: (input: {
    historyItems: LauncherHistoryItem[]
    idleItems: LocalStartItem[]
    useWithDisabledCommandKeys: string[]
    windowMode: LauncherWindowMode
  }) => void
  applySearchResults: (
    requestId: number,
    query: string,
    source: LauncherSearchSource,
    results: LauncherSearchResult[]
  ) => void
  applySearchResultsBySource: (
    requestId: number,
    query: string,
    resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
  ) => void
  beginSearchRequest: () => number
  historyItems: LauncherHistoryItem[]
  homeInputSelectionRequestVersion: number
  idleItems: LocalStartItem[]
  invalidateSearchRequests: () => void
  moveSelection: (itemIds: readonly string[], currentSelectedIndex: number, delta: number) => void
  query: string
  removeHistoryItemLocal: (itemId: string) => void
  requestHomeInputSelection: () => void
  searchState: LauncherSearchState | null
  selectedItemId: string | null
  setHistoryItemPinnedLocal: (itemId: string, pin: boolean, updatedAt: string) => void
  setQuery: (value: string) => void
  setSelectedItemId: (value: string | null) => void
  setUseWithDisabledCommandKeysLocal: (commandKeys: string[]) => void
  useWithDisabledCommandKeys: string[]
  windowMode: LauncherWindowMode
}

export interface LauncherSearchPageStore {
  getState: () => LauncherSearchPageStoreState
  subscribe: (listener: () => void) => () => void
}

interface LauncherSearchPageData {
  historyItems: LauncherHistoryItem[]
  homeInputSelectionRequestVersion: number
  idleItems: LocalStartItem[]
  query: string
  searchState: LauncherSearchState | null
  selectedItemId: string | null
  useWithDisabledCommandKeys: string[]
  windowMode: LauncherWindowMode
}

const initialData: LauncherSearchPageData = {
  historyItems: [],
  homeInputSelectionRequestVersion: 0,
  idleItems: [],
  query: "",
  searchState: null,
  selectedItemId: null,
  useWithDisabledCommandKeys: [],
  windowMode: "default"
}

function normalizeLauncherSearchFilterValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function filterCachedLauncherSearchResults(
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>,
  query: string
): Partial<Record<LauncherSearchSource, LauncherSearchResult[]>> {
  const normalizedQuery = normalizeLauncherSearchFilterValue(query)
  if (!normalizedQuery) {
    return resultsBySource
  }

  return Object.fromEntries(
    LAUNCHER_SEARCH_SOURCES.filter((source) => resultsBySource[source] !== undefined).map(
      (source) => [
        source,
        (resultsBySource[source] ?? []).filter((result) => {
          const haystack = normalizeLauncherSearchFilterValue(
            `${result.title} ${result.subtitle ?? ""} ${result.id}`
          )
          return haystack.includes(normalizedQuery)
        })
      ]
    )
  ) as Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
}

export function resolveVisibleLauncherSearchResultsBySource(
  searchState: LauncherSearchState | null,
  query: string
): Partial<Record<LauncherSearchSource, LauncherSearchResult[]>> | null {
  const trimmedQuery = query.trim()
  if (!trimmedQuery || !searchState) {
    return null
  }

  if (searchState.query === trimmedQuery) {
    return searchState.resultsBySource
  }

  if (trimmedQuery.startsWith(searchState.query)) {
    return filterCachedLauncherSearchResults(searchState.resultsBySource, trimmedQuery)
  }

  if (searchState.query.startsWith(trimmedQuery)) {
    return searchState.resultsBySource
  }

  return null
}

export function shouldPreviewLauncherSearchResults(
  searchState: LauncherSearchState | null,
  query: string
): boolean {
  const trimmedQuery = query.trim()
  return Boolean(
    trimmedQuery &&
    searchState &&
    searchState.query !== trimmedQuery &&
    searchState.query.startsWith(trimmedQuery)
  )
}

export function mergeLauncherSearchResults(
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>,
  limit: number
): LauncherSearchResult[] {
  const seen = new Set<string>()
  let visibleThreadResults = 0

  return LAUNCHER_SEARCH_SOURCES.flatMap((source) => resultsBySource[source] ?? [])
    .sort((left, right) => {
      const leftOrder = launcherSearchSourceOrder.get(left.source) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = launcherSearchSourceOrder.get(right.source) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.title.localeCompare(right.title)
    })
    .filter((result) => {
      const key = `${result.source}:${result.id}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      if (result.source === "threads") {
        if (visibleThreadResults >= MAX_VISIBLE_THREAD_SEARCH_RESULTS) {
          return false
        }

        visibleThreadResults += 1
      }

      return true
    })
    .slice(0, limit)
}

export function createEmptyLauncherSearchResultsBySource(
  sources: readonly LauncherSearchSource[] = LAUNCHER_SEARCH_SOURCES
): Partial<Record<LauncherSearchSource, LauncherSearchResult[]>> {
  const entries: Array<readonly [LauncherSearchSource, LauncherSearchResult[]]> = []

  for (const source of sources) {
    if (launcherSearchSourceSet.has(source)) {
      entries.push([source, []])
    }
  }

  return Object.fromEntries(entries) as Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
}

export function groupLauncherSearchResultsBySource(
  results: readonly LauncherSearchResult[],
  sources: readonly LauncherSearchSource[] = LAUNCHER_SEARCH_SOURCES
): Partial<Record<LauncherSearchSource, LauncherSearchResult[]>> {
  const resultsBySource = createEmptyLauncherSearchResultsBySource(sources)

  for (const result of results) {
    if (!launcherSearchSourceSet.has(result.source)) {
      continue
    }

    resultsBySource[result.source] = [...(resultsBySource[result.source] ?? []), result]
  }

  return resultsBySource
}

export function createLauncherSearchPageStore(): LauncherSearchPageStore {
  const listeners = new Set<() => void>()
  let latestSearchRequestId = 0
  let data: LauncherSearchPageData = { ...initialData }
  let snapshot: LauncherSearchPageStoreState

  const emit = (): void => {
    snapshot = {
      ...data,
      ...actions
    }
    listeners.forEach((listener) => listener())
  }

  const setData = (
    update:
      | Partial<LauncherSearchPageData>
      | ((current: LauncherSearchPageData) => Partial<LauncherSearchPageData>)
  ): void => {
    const nextPartial = typeof update === "function" ? update(data) : update
    let changed = false

    for (const key of Object.keys(nextPartial) as (keyof LauncherSearchPageData)[]) {
      if (!Object.is(data[key], nextPartial[key])) {
        changed = true
        break
      }
    }

    if (!changed) {
      return
    }

    data = {
      ...data,
      ...nextPartial
    }
    emit()
  }

  const actions = {
    setQuery: (value: string): void => {
      setData({ query: value })
    },
    setSelectedItemId: (value: string | null): void => {
      setData({ selectedItemId: value })
    },
    requestHomeInputSelection: (): void => {
      setData((current) => ({
        homeInputSelectionRequestVersion: current.homeInputSelectionRequestVersion + 1
      }))
    },
    applyIdleState: (input: {
      historyItems: LauncherHistoryItem[]
      idleItems: LocalStartItem[]
      useWithDisabledCommandKeys: string[]
      windowMode: LauncherWindowMode
    }): void => {
      setData({
        historyItems: input.historyItems,
        idleItems: input.idleItems,
        useWithDisabledCommandKeys: input.useWithDisabledCommandKeys,
        windowMode: input.windowMode
      })
    },
    beginSearchRequest: (): number => {
      latestSearchRequestId += 1
      return latestSearchRequestId
    },
    invalidateSearchRequests: (): void => {
      latestSearchRequestId += 1
    },
    applySearchResults: (
      requestId: number,
      query: string,
      source: LauncherSearchSource,
      results: LauncherSearchResult[]
    ): void => {
      if (latestSearchRequestId !== requestId) {
        return
      }

      setData((current) => ({
        searchState: {
          query,
          resultsBySource: {
            ...(current.searchState?.query === query ? current.searchState.resultsBySource : {}),
            [source]: results
          }
        }
      }))
    },
    applySearchResultsBySource: (
      requestId: number,
      query: string,
      resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
    ): void => {
      if (latestSearchRequestId !== requestId) {
        return
      }

      setData({
        searchState: {
          query,
          resultsBySource
        }
      })
    },
    moveSelection: (
      itemIds: readonly string[],
      currentSelectedIndex: number,
      delta: number
    ): void => {
      if (itemIds.length === 0) {
        return
      }

      const nextIndex = (currentSelectedIndex + delta + itemIds.length) % itemIds.length
      setData({ selectedItemId: itemIds[nextIndex] ?? null })
    },
    setHistoryItemPinnedLocal: (itemId: string, pin: boolean, updatedAt: string): void => {
      setData((current) => ({
        historyItems: sortLauncherHistoryItems(
          current.historyItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  pin,
                  updatedAt
                }
              : item
          )
        )
      }))
    },
    removeHistoryItemLocal: (itemId: string): void => {
      setData((current) => ({
        historyItems: current.historyItems.filter((item) => item.id !== itemId)
      }))
    },
    setUseWithDisabledCommandKeysLocal: (commandKeys: string[]): void => {
      setData({ useWithDisabledCommandKeys: commandKeys })
    }
  }

  snapshot = {
    ...data,
    ...actions
  }

  return {
    getState: (): LauncherSearchPageStoreState => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
