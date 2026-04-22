import { useCallback, useEffect, useMemo } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherViewportHeightForBody,
  getLauncherViewportHeight,
  type LauncherShellConfig
} from "@shared/launcher"
import { useI18n } from "@/lib/i18n"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { DEFAULT_HOME_COMMAND, resolveLauncherCommand } from "../pages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  resolveLauncherHomeSurfaceSelectedIndex,
  type LauncherHomeSurfaceModel
} from "../home-surface"
import type { LauncherCommandAddress, LauncherCommandOpenOptions } from "../pages/types"
import {
  LAUNCHER_SEARCH_SOURCES,
  mergeLauncherSearchResults,
  resolveVisibleLauncherSearchResultsBySource,
  shouldPreviewLauncherSearchResults
} from "./launcher-search-page-store-core"
import { useLauncherSearchPageStore } from "./launcher-search-page-store"
import { useLauncherHomeClipboard } from "./useLauncherHomeClipboard"

type LauncherHomeCommandId =
  | typeof LAUNCHER_COMMAND_IDS.searchOpenAi
  | typeof LAUNCHER_COMMAND_IDS.searchOpenSettings
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionDown
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionUp
  | typeof LAUNCHER_COMMAND_IDS.searchExecuteSelection

export function useLauncherSearchPage(props: {
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}): {
  executeItem: (index: number) => void
  clearClipboardContext: () => void
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  handleInputCommandKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  homeInputSelectionRequestVersion: number
  isSearchLoading: boolean
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
  const query = useLauncherSearchPageStore((state) => state.query)
  const historyItems = useLauncherSearchPageStore((state) => state.historyItems)
  const searchState = useLauncherSearchPageStore((state) => state.searchState)
  const idleItems = useLauncherSearchPageStore((state) => state.idleItems)
  const windowMode = useLauncherSearchPageStore((state) => state.windowMode)
  const selectedItemId = useLauncherSearchPageStore((state) => state.selectedItemId)
  const homeInputSelectionRequestVersion = useLauncherSearchPageStore(
    (state) => state.homeInputSelectionRequestVersion
  )
  const setQuery = useLauncherSearchPageStore((state) => state.setQuery)
  const applyIdleState = useLauncherSearchPageStore((state) => state.applyIdleState)
  const beginSearchRequest = useLauncherSearchPageStore((state) => state.beginSearchRequest)
  const invalidateSearchRequests = useLauncherSearchPageStore(
    (state) => state.invalidateSearchRequests
  )
  const applySearchResults = useLauncherSearchPageStore((state) => state.applySearchResults)
  const moveSelection = useLauncherSearchPageStore((state) => state.moveSelection)
  const requestHomeInputSelection = useLauncherSearchPageStore(
    (state) => state.requestHomeInputSelection
  )
  const setHistoryItemPinnedLocal = useLauncherSearchPageStore(
    (state) => state.setHistoryItemPinnedLocal
  )
  const removeHistoryItemLocal = useLauncherSearchPageStore((state) => state.removeHistoryItemLocal)
  const shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
  const trimmedQuery = query.trim()

  const visibleSearchResultsBySource = useMemo(() => {
    return resolveVisibleLauncherSearchResultsBySource(searchState, trimmedQuery)
  }, [searchState, trimmedQuery])
  const searchResultsPreview = useMemo(() => {
    return shouldPreviewLauncherSearchResults(searchState, trimmedQuery)
  }, [searchState, trimmedQuery])
  const searchResults = useMemo(() => {
    if (!visibleSearchResultsBySource) {
      return []
    }

    return mergeLauncherSearchResults(visibleSearchResultsBySource, MAX_LAUNCHER_SEARCH_RESULTS)
  }, [visibleSearchResultsBySource])
  const isSearchLoading = useMemo(() => {
    if (!trimmedQuery) {
      return false
    }

    if (!searchState || searchState.query !== trimmedQuery) {
      return true
    }

    return LAUNCHER_SEARCH_SOURCES.some(
      (source) => searchState.resultsBySource[source] === undefined
    )
  }, [searchState, trimmedQuery])
  const surface = useMemo(
    () =>
      buildLauncherHomeSurfaceModel({
        copy,
        historyItems,
        idleItems,
        locale,
        query,
        searchResults,
        searchResultsPreview,
        windowMode
      }),
    [copy, historyItems, idleItems, locale, query, searchResults, searchResultsPreview, windowMode]
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
      applyIdleState({
        historyItems: launcherHistoryItems,
        idleItems: localStartItems,
        windowMode: settings.windowMode
      })
    })
  }, [applyIdleState])
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
      invalidateSearchRequests()
      return
    }

    const debounceTimer = window.setTimeout(() => {
      const requestId = beginSearchRequest()

      for (const source of LAUNCHER_SEARCH_SOURCES) {
        void window.api.launcher
          .search({
            limit: MAX_LAUNCHER_SEARCH_RESULTS,
            query: trimmedQuery,
            sources: [source]
          })
          .then((response) => {
            applySearchResults(requestId, trimmedQuery, source, response.results)
          })
          .catch(() => {
            applySearchResults(requestId, trimmedQuery, source, [])
          })
      }
    }, 100)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [applySearchResults, beginSearchRequest, invalidateSearchRequests, trimmedQuery])

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
    [navigateToCommand, query, setQuery, surface.items]
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
        case LAUNCHER_COMMAND_IDS.searchOpenSettings:
          void window.api.settings.openWindow()
          return
        case LAUNCHER_COMMAND_IDS.searchMoveSelectionDown:
          moveSelection(
            surface.items.map((item) => item.id),
            selectedIndex,
            1
          )
          return
        case LAUNCHER_COMMAND_IDS.searchMoveSelectionUp:
          moveSelection(
            surface.items.map((item) => item.id),
            selectedIndex,
            -1
          )
          return
        case LAUNCHER_COMMAND_IDS.searchExecuteSelection:
          executeItem(selectedIndex)
          return
        default:
          return
      }
    },
    [executeItem, moveSelection, navigateToCommand, query, selectedIndex, surface.items]
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
      setHistoryItemPinnedLocal(itemId, pin, updatedAt)

      void window.api.launcherHistory.setPinned(itemId, pin).catch((error) => {
        console.warn("[Launcher] Failed to update history pin:", error)
        refreshIdleState()
      })
    },
    [refreshIdleState, setHistoryItemPinnedLocal]
  )
  const removeHistoryItem = useCallback(
    (itemId: string): void => {
      removeHistoryItemLocal(itemId)

      void window.api.launcherHistory.remove(itemId).catch((error) => {
        console.warn("[Launcher] Failed to remove history item:", error)
        refreshIdleState()
      })
    },
    [refreshIdleState, removeHistoryItemLocal]
  )

  return {
    clearClipboardContext: homeClipboard.clearContext,
    executeItem,
    executeHomeCommand,
    handleInputCommandKeyDown,
    homeInputSelectionRequestVersion,
    isSearchLoading,
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
