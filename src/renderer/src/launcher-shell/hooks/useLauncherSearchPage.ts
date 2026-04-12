import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherViewportHeightForBody,
  getLauncherViewportHeight,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import { useI18n } from "@/lib/i18n"
import type { LauncherSearchResult, LauncherSearchSource } from "../../../../shared/launcher-search"
import type { LauncherHistoryItem } from "../../../../shared/launcher-history"
import { sortLauncherHistoryItems } from "../../../../shared/launcher-history"
import type { LocalStartItem } from "../../../../shared/local-start"
import { LAUNCHER_COMMAND_IDS } from "../../../../shared/shortcuts/ids"
import { DEFAULT_HOME_COMMAND, resolveLauncherCommand } from "../pages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  resolveLauncherHomeSurfaceSelectedIndex,
  type LauncherHomeSurfaceModel
} from "../home-surface"
import type { LauncherCommandAddress, LauncherCommandOpenOptions } from "../pages/types"
import { useLauncherHomeClipboard } from "./useLauncherHomeClipboard"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []
const LAUNCHER_SEARCH_SOURCES: LauncherSearchSource[] = [
  "applications",
  "threads",
  "files",
  "browser-history"
]
const launcherSearchSourceOrder = new Map(
  LAUNCHER_SEARCH_SOURCES.map((source, index) => [source, index])
)
type LauncherHomeCommandId =
  | typeof LAUNCHER_COMMAND_IDS.searchOpenAi
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionDown
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionUp
  | typeof LAUNCHER_COMMAND_IDS.searchExecuteSelection

interface LauncherSearchState {
  query: string
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
}

function normalizeLauncherSearchFilterValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function filterCachedLauncherSearchResults(
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>,
  query: string
): Partial<Record<LauncherSearchSource, LauncherSearchResult[]>> {
  const normalizedQuery = normalizeLauncherSearchFilterValue(query)
  if (!normalizedQuery) {
    return resultsBySource
  }

  return Object.fromEntries(
    Object.entries(resultsBySource).map(([source, results]) => [
      source,
      (results ?? []).filter((result) => {
        const haystack = normalizeLauncherSearchFilterValue(
          `${result.title} ${result.subtitle ?? ""} ${result.id}`
        )
        return haystack.includes(normalizedQuery)
      })
    ])
  ) as Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>
}

function mergeLauncherSearchResults(
  resultsBySource: Partial<Record<LauncherSearchSource, LauncherSearchResult[]>>,
  limit: number
): LauncherSearchResult[] {
  const seen = new Set<string>()

  return Object.values(resultsBySource)
    .flat()
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftOrder = launcherSearchSourceOrder.get(left.source) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = launcherSearchSourceOrder.get(right.source) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.title.localeCompare(right.title)
    })
    .filter((result) => {
      const key = `${result.source}:${result.id}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .slice(0, limit)
}

export function useLauncherSearchPage(props: {
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}): {
  executeItem: (index: number) => void
  clearClipboardContext: () => void
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  handleInputCommandKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  homeInputSelectionRequestVersion: number
  removeHistoryItem: (itemId: string) => void
  setHistoryItemPinned: (itemId: string, pin: boolean) => void
  previewClipboardContext: Extract<
    import("../../../../shared/clipboard").ClipboardContext,
    { kind: "files" | "image" }
  > | null
  query: string
  resultsViewportHeight: number
  selectedIndex: number
  setQuery: (value: string) => void
  shellConfig: LauncherShellConfig
  surface: LauncherHomeSurfaceModel
  viewportHeight: number
} {
  const { openCommand: navigateToCommand } = props
  const { copy, locale } = useI18n()
  const latestSearchRequestRef = useRef(0)
  const [query, setQuery] = useState("")
  const [historyItems, setHistoryItems] = useState<LauncherHistoryItem[]>([])
  const [searchState, setSearchState] = useState<LauncherSearchState | null>(null)
  const [idleItems, setIdleItems] = useState<LocalStartItem[]>([])
  const [windowMode, setWindowMode] = useState<"default" | "compact">("default")
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [homeInputSelectionRequestVersion, setHomeInputSelectionRequestVersion] = useState(0)
  const shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
  const trimmedQuery = query.trim()

  const visibleSearchResultsBySource = useMemo(() => {
    if (!trimmedQuery || !searchState) {
      return null
    }

    if (searchState.query === trimmedQuery) {
      return searchState.resultsBySource
    }

    if (trimmedQuery.startsWith(searchState.query)) {
      return filterCachedLauncherSearchResults(searchState.resultsBySource, trimmedQuery)
    }

    return null
  }, [searchState, trimmedQuery])
  const searchResults = visibleSearchResultsBySource
    ? mergeLauncherSearchResults(visibleSearchResultsBySource, MAX_LAUNCHER_SEARCH_RESULTS)
    : EMPTY_SEARCH_RESULTS
  const surface = useMemo(
    () =>
      buildLauncherHomeSurfaceModel({
        copy,
        historyItems,
        idleItems,
        locale,
        query,
        searchResults,
        windowMode
      }),
    [copy, historyItems, idleItems, locale, query, searchResults, windowMode]
  )
  const selectedIndex = useMemo(() => {
    return resolveLauncherHomeSurfaceSelectedIndex(surface, selectedItemId)
  }, [selectedItemId, surface])
  const resultsViewportHeight = useMemo(() => {
    return getLauncherHomeSurfaceResultsHeight(surface, shellConfig)
  }, [shellConfig, surface])
  const viewportHeight = useMemo(() => {
    if (resultsViewportHeight === 0) {
      return getLauncherViewportHeight(0, shellConfig)
    }

    return getLauncherViewportHeightForBody(resultsViewportHeight, shellConfig)
  }, [resultsViewportHeight, shellConfig])
  const requestHomeInputSelection = useCallback((): void => {
    setHomeInputSelectionRequestVersion((version) => version + 1)
  }, [])
  const homeClipboard = useLauncherHomeClipboard({
    query,
    requestSelection: requestHomeInputSelection,
    setQuery
  })
  const refreshIdleState = useCallback((): void => {
    void Promise.all([
      window.api.settings.getLauncherSettings(),
      window.api.launcherHistory.list(),
      window.api.localStart.list()
    ]).then(([settings, launcherHistoryItems, localStartItems]) => {
      setWindowMode(settings.windowMode)
      setHistoryItems(launcherHistoryItems)
      setIdleItems(localStartItems)
    })
  }, [])
  useEffect(() => {
    refreshIdleState()
    const cleanupShown = window.api.launcher.onShown(() => {
      refreshIdleState()
    })

    return () => {
      cleanupShown()
    }
  }, [refreshIdleState])

  useEffect(() => {
    if (!trimmedQuery) {
      latestSearchRequestRef.current += 1
      return
    }

    const debounceTimer = window.setTimeout(() => {
      const requestId = latestSearchRequestRef.current + 1
      latestSearchRequestRef.current = requestId

      for (const source of LAUNCHER_SEARCH_SOURCES) {
        void window.api.launcher
          .search({
            limit: MAX_LAUNCHER_SEARCH_RESULTS,
            query: trimmedQuery,
            sources: [source]
          })
          .then((response) => {
            if (latestSearchRequestRef.current === requestId) {
              setSearchState((current) => ({
                query: trimmedQuery,
                resultsBySource: {
                  ...(current?.query === trimmedQuery ? current.resultsBySource : {}),
                  [source]: response.results
                }
              }))
            }
          })
          .catch(() => {
            if (latestSearchRequestRef.current === requestId) {
              setSearchState((current) => ({
                query: trimmedQuery,
                resultsBySource: {
                  ...(current?.query === trimmedQuery ? current.resultsBySource : {}),
                  [source]: []
                }
              }))
            }
          })
      }
    }, 100)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [trimmedQuery])

  const moveSelection = useCallback(
    (delta: number): void => {
      if (surface.items.length === 0) {
        return
      }

      const nextIndex = (selectedIndex + delta + surface.items.length) % surface.items.length
      setSelectedItemId(surface.items[nextIndex]?.id ?? null)
    },
    [selectedIndex, surface.items]
  )

  const executeItem = useCallback(
    (index: number): void => {
      const item = surface.items[index]
      if (!item || item.availability === "planned") {
        return
      }

      if (item.command?.type === "replace-query") {
        setQuery(item.command.value)
        return
      }

      if (item.commandRef) {
        navigateToCommand(item.commandRef, item.commandOpenOptions ?? { seedQuery: query })
        return
      }

      if (item.action.type === "none") {
        return
      }

      void window.api.launcher.executeAction(item.action).then((result) => {
        if (!result.ok) {
          console.warn("[Launcher] Failed to execute action:", result.error)
        }
      })
    },
    [navigateToCommand, query, surface.items]
  )

  const executeHomeCommand = useCallback(
    (commandId: LauncherHomeCommandId): void => {
      switch (commandId) {
        case LAUNCHER_COMMAND_IDS.searchOpenAi:
          navigateToCommand(DEFAULT_HOME_COMMAND, {
            initialAction: query.trim() ? "submit" : "focus",
            seedQuery: query
          })
          return
        case LAUNCHER_COMMAND_IDS.searchMoveSelectionDown:
          moveSelection(1)
          return
        case LAUNCHER_COMMAND_IDS.searchMoveSelectionUp:
          moveSelection(-1)
          return
        case LAUNCHER_COMMAND_IDS.searchExecuteSelection:
          executeItem(selectedIndex)
          return
        default:
          return
      }
    },
    [executeItem, moveSelection, navigateToCommand, query, selectedIndex]
  )

  const handleInputCommandKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      const commandMatch = resolveLauncherCommand({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        query,
        shiftKey: event.shiftKey
      })
      if (commandMatch) {
        event.preventDefault()
        navigateToCommand(commandMatch.address, commandMatch.match.openOptions)
        return
      }
    },
    [navigateToCommand, query]
  )
  const setHistoryItemPinned = useCallback(
    (itemId: string, pin: boolean): void => {
      const updatedAt = new Date().toISOString()
      setHistoryItems((currentItems) =>
        sortLauncherHistoryItems(
          currentItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  pin,
                  updatedAt
                }
              : item
          )
        )
      )

      void window.api.launcherHistory.setPinned(itemId, pin).catch((error) => {
        console.warn("[Launcher] Failed to update history pin:", error)
        refreshIdleState()
      })
    },
    [refreshIdleState]
  )
  const removeHistoryItem = useCallback(
    (itemId: string): void => {
      setHistoryItems((currentItems) => currentItems.filter((item) => item.id !== itemId))

      void window.api.launcherHistory.remove(itemId).catch((error) => {
        console.warn("[Launcher] Failed to remove history item:", error)
        refreshIdleState()
      })
    },
    [refreshIdleState]
  )

  return {
    clearClipboardContext: homeClipboard.clearContext,
    executeItem,
    executeHomeCommand,
    handleInputCommandKeyDown,
    homeInputSelectionRequestVersion,
    previewClipboardContext: homeClipboard.previewContext,
    removeHistoryItem,
    setHistoryItemPinned,
    query,
    resultsViewportHeight,
    selectedIndex,
    setQuery,
    shellConfig,
    surface,
    viewportHeight
  }
}
