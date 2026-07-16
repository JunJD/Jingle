import { useCallback, useEffect, useMemo } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  LAUNCHER_SEARCH_TRANSACTION_TIMEOUT_MS,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherIdleHeight,
  getLauncherViewportHeightForBody,
  getLauncherViewportHeight,
  type LauncherShellConfig
} from "@shared/launcher"
import { useI18n } from "@/lib/i18n"
import { useNativeSourceMentionsProjection } from "@extension-host/use-native-source-mentions-projection"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { DEFAULT_HOME_COMMAND, listLauncherCommands, resolveLauncherCommand } from "../pages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  getLauncherSearchResultsViewportHeight,
  resolveLauncherHomeSurfaceSelectedIndex,
  type LauncherHomeSurfaceModel
} from "../home-surface"
import type { LauncherCommandAddress, LauncherCommandOpenOptions } from "../pages/types"
import type { LauncherIndexedCommand } from "../pages"
import {
  LAUNCHER_SEARCH_SOURCES,
  groupLauncherSearchResultsBySource,
  mergeLauncherSearchResults,
  resolveVisibleLauncherSearchResultsBySource,
  shouldPreviewLauncherSearchResults
} from "./launcher-search-page-store-core"
import { useLauncherSearchPageStore } from "./launcher-search-page-store"
import { useLauncherHomeClipboard } from "./useLauncherHomeClipboard"
import {
  getLauncherCommandAddressKey,
  setLauncherUseWithCommandEnabled,
  splitLauncherUseWithCommands
} from "../use-with-preferences"

type LauncherHomeCommandId =
  | typeof LAUNCHER_COMMAND_IDS.searchOpenAi
  | typeof LAUNCHER_COMMAND_IDS.searchOpenMainHistory
  | typeof LAUNCHER_COMMAND_IDS.searchOpenSettings
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionDown
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionUp
  | typeof LAUNCHER_COMMAND_IDS.searchExecuteSelection

function settleLauncherSearchResponses<T>(
  promises: Promise<T>[],
  timeoutMs: number
): Promise<PromiseSettledResult<T>[]> {
  return new Promise((resolve) => {
    const results: PromiseSettledResult<T>[] = []
    let isSettled = false
    let settledCount = 0
    const finish = (): void => {
      if (isSettled) {
        return
      }

      isSettled = true
      window.clearTimeout(timeout)
      resolve(results)
    }
    const timeout = window.setTimeout(finish, timeoutMs)

    promises.forEach((promise) => {
      void promise
        .then((value) => {
          if (isSettled) {
            return
          }

          results.push({
            status: "fulfilled",
            value
          })
        })
        .catch((reason: unknown) => {
          if (isSettled) {
            return
          }

          results.push({
            reason,
            status: "rejected"
          })
        })
        .finally(() => {
          if (isSettled) {
            return
          }

          settledCount += 1
          if (settledCount === promises.length) {
            finish()
          }
        })
    })
  })
}

export function useLauncherSearchPage(props: {
  openMainHistory: () => void
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}): {
  acceptClipboardCandidate: () => void
  executeItem: (index: number) => void
  clearClipboardContext: () => void
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  handleInputCommandKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  homeInputSelectionRequestVersion: number
  isSearchLoading: boolean
  removeHistoryItem: (itemId: string) => void
  setHistoryItemPinned: (itemId: string, pin: boolean) => void
  previewClipboardContext: import("../../../../shared/clipboard").ClipboardContext
  query: string
  resultsViewportHeight: number
  selectedIndex: number
  setQuery: (value: string) => void
  shellConfig: LauncherShellConfig
  surface: LauncherHomeSurfaceModel
  useWithManager: {
    availableCommands: LauncherIndexedCommand[]
    enabledCommands: LauncherIndexedCommand[]
    setCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
  }
  viewportHeight: number
} {
  const { openCommand: navigateToCommand, openMainHistory } = props
  const { copy, locale } = useI18n()
  const query = useLauncherSearchPageStore((state) => state.query)
  const historyItems = useLauncherSearchPageStore((state) => state.historyItems)
  const searchState = useLauncherSearchPageStore((state) => state.searchState)
  const idleItems = useLauncherSearchPageStore((state) => state.idleItems)
  const useWithDisabledCommandKeys = useLauncherSearchPageStore(
    (state) => state.useWithDisabledCommandKeys
  )
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
  const applySearchResultsBySource = useLauncherSearchPageStore(
    (state) => state.applySearchResultsBySource
  )
  const moveSelection = useLauncherSearchPageStore((state) => state.moveSelection)
  const requestHomeInputSelection = useLauncherSearchPageStore(
    (state) => state.requestHomeInputSelection
  )
  const setHistoryItemPinnedLocal = useLauncherSearchPageStore(
    (state) => state.setHistoryItemPinnedLocal
  )
  const removeHistoryItemLocal = useLauncherSearchPageStore((state) => state.removeHistoryItemLocal)
  const setUseWithDisabledCommandKeysLocal = useLauncherSearchPageStore(
    (state) => state.setUseWithDisabledCommandKeysLocal
  )
  const shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
  const trimmedQuery = query.trim()
  const useWithCommands = useMemo(
    () =>
      listLauncherCommands(locale).filter(
        (command) => command.address.kind === "extension-command"
      ),
    [locale]
  )
  const useWithCommandGroups = useMemo(
    () => splitLauncherUseWithCommands(useWithCommands, useWithDisabledCommandKeys),
    [useWithCommands, useWithDisabledCommandKeys]
  )
  const sourceMentions = useNativeSourceMentionsProjection(locale)

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
        sourceMentions,
        useWithDisabledCommandKeys,
        windowMode
      }),
    [
      copy,
      historyItems,
      idleItems,
      locale,
      query,
      searchResults,
      searchResultsPreview,
      sourceMentions,
      useWithDisabledCommandKeys,
      windowMode
    ]
  )
  const selectedIndex = useMemo(() => {
    return resolveLauncherHomeSurfaceSelectedIndex(surface, selectedItemId)
  }, [selectedItemId, surface])
  const resultsViewportHeight = useMemo(() => {
    if (trimmedQuery) {
      return getLauncherSearchResultsViewportHeight(shellConfig)
    }

    return getLauncherHomeSurfaceResultsHeight(surface, shellConfig)
  }, [shellConfig, surface, trimmedQuery])
  const viewportHeight = useMemo(() => {
    if (resultsViewportHeight === 0) {
      return getLauncherViewportHeight(0, shellConfig)
    }

    if (!surface.chrome.footerVisible) {
      return getLauncherIdleHeight(shellConfig) + resultsViewportHeight
    }

    return getLauncherViewportHeightForBody(resultsViewportHeight, shellConfig)
  }, [resultsViewportHeight, shellConfig, surface.chrome.footerVisible])
  const homeClipboard = useLauncherHomeClipboard({
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
        useWithDisabledCommandKeys: settings.useWithDisabledCommandKeys,
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

  const refreshSearchResults = useCallback(
    (searchQuery: string): void => {
      const requestId = beginSearchRequest()

      void settleLauncherSearchResponses(
        LAUNCHER_SEARCH_SOURCES.map((source) =>
          window.api.launcher
            .search({
              limit: MAX_LAUNCHER_SEARCH_RESULTS,
              query: searchQuery,
              sources: [source]
            })
            .then((response) => response.results)
        ),
        LAUNCHER_SEARCH_TRANSACTION_TIMEOUT_MS
      ).then((responses) => {
        applySearchResultsBySource(
          requestId,
          searchQuery,
          groupLauncherSearchResultsBySource(
            responses.flatMap((response) => (response.status === "fulfilled" ? response.value : []))
          )
        )
      })
    },
    [applySearchResultsBySource, beginSearchRequest]
  )

  useEffect(() => {
    if (!trimmedQuery) {
      invalidateSearchRequests()
      return
    }

    const debounceTimer = window.setTimeout(() => {
      refreshSearchResults(trimmedQuery)
    }, 100)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [invalidateSearchRequests, refreshSearchResults, trimmedQuery])

  useEffect(() => {
    const cleanupIndexUpdated = window.api.launcher.onSearchIndexUpdated(() => {
      if (trimmedQuery) {
        refreshSearchResults(trimmedQuery)
      }
    })

    return () => {
      cleanupIndexUpdated()
    }
  }, [refreshSearchResults, trimmedQuery])

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
        case LAUNCHER_COMMAND_IDS.searchOpenMainHistory:
          openMainHistory()
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
    [
      executeItem,
      moveSelection,
      navigateToCommand,
      openMainHistory,
      query,
      selectedIndex,
      surface.items
    ]
  )

  const handleInputCommandKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
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
  const setUseWithCommandEnabled = useCallback(
    (command: LauncherIndexedCommand, enabled: boolean): void => {
      const nextCommandKeys = setLauncherUseWithCommandEnabled(
        useWithDisabledCommandKeys,
        getLauncherCommandAddressKey(command.address),
        enabled
      )
      setUseWithDisabledCommandKeysLocal(nextCommandKeys)

      void window.api.settings
        .setLauncherSettings({ useWithDisabledCommandKeys: nextCommandKeys })
        .then((settings) => {
          setUseWithDisabledCommandKeysLocal(settings.useWithDisabledCommandKeys)
        })
        .catch((error) => {
          console.warn("[Launcher] Failed to update use-with commands:", error)
          refreshIdleState()
        })
    },
    [refreshIdleState, setUseWithDisabledCommandKeysLocal, useWithDisabledCommandKeys]
  )

  return {
    acceptClipboardCandidate: homeClipboard.acceptCandidate,
    clearClipboardContext: homeClipboard.clearContext,
    executeItem,
    executeHomeCommand,
    handleInputCommandKeyDown,
    homeInputSelectionRequestVersion,
    isSearchLoading,
    previewClipboardContext: homeClipboard.candidateContext,
    removeHistoryItem,
    setHistoryItemPinned,
    query,
    resultsViewportHeight,
    selectedIndex,
    setQuery,
    shellConfig,
    surface,
    useWithManager: {
      availableCommands: useWithCommandGroups.availableCommands,
      enabledCommands: useWithCommandGroups.enabledCommands,
      setCommandEnabled: setUseWithCommandEnabled
    },
    viewportHeight
  }
}
