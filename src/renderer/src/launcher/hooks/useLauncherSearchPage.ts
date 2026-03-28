import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherResultsHeight,
  getLauncherViewportHeightForBody,
  getLauncherViewportHeight,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import { useI18n } from "@/lib/i18n"
import type {
  LauncherSearchResponse,
  LauncherSearchResult
} from "../../../../shared/launcher-search"
import type { LauncherHistoryItem } from "../../../../shared/launcher-history"
import type { LocalStartItem } from "../../../../shared/local-start"
import { shouldShowLauncherIdleItems } from "../../../../shared/launcher-settings"
import { useLauncherClipboard } from "../LauncherClipboardContext"
import {
  DEFAULT_HOME_ENTRY,
  getLauncherHomeEntries,
  getLauncherPluginIntents,
  resolveLauncherPluginCommand
} from "../pages"
import {
  buildLauncherHistoryShellItems,
  buildLauncherLocalStartShellItems,
  buildLauncherPluginIntentShellItems,
  buildLauncherSearchShellItems
} from "../search-items"
import type {
  LauncherHomeEntry,
  LauncherPluginEntryAddress,
  LauncherPluginOpenOptions
} from "../pages/types"
import type { LauncherShellItem } from "../types"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []

export function useLauncherSearchPage(props: {
  openEntry: (address: LauncherPluginEntryAddress, options?: LauncherPluginOpenOptions) => void
}): {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  homeSurfaceMode: "history" | "idle" | "results"
  items: LauncherShellItem[]
  openEntry: (entry: LauncherHomeEntry, options?: LauncherPluginOpenOptions) => void
  placeholder: string
  query: string
  resultsViewportHeight: number
  resultsVisible: boolean
  selectedIndex: number
  setQuery: (value: string) => void
  shellConfig: LauncherShellConfig
  viewportHeight: number
} {
  const { openEntry: navigateToEntry } = props
  const { copy, locale } = useI18n()
  const { context, isTextAutofillConsumed, markTextAutofillConsumed } = useLauncherClipboard()
  const latestSearchRequestRef = useRef(0)
  const [query, setQuery] = useState("")
  const [historyItems, setHistoryItems] = useState<LauncherHistoryItem[]>([])
  const [searchResponse, setSearchResponse] = useState<LauncherSearchResponse | null>(null)
  const [idleItems, setIdleItems] = useState<LocalStartItem[]>([])
  const [windowMode, setWindowMode] = useState<"default" | "compact">("default")
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
  const trimmedQuery = query.trim()

  const searchResults =
    trimmedQuery && searchResponse?.query === trimmedQuery
      ? searchResponse.results
      : EMPTY_SEARCH_RESULTS
  const homeSurfaceMode = useMemo<"history" | "idle" | "results">(() => {
    if (trimmedQuery) {
      return "results"
    }

    if (!shouldShowLauncherIdleItems(windowMode)) {
      return "idle"
    }

    return historyItems.length > 0 ? "history" : "idle"
  }, [historyItems.length, trimmedQuery, windowMode])
  const items = useMemo(() => {
    if (!query.trim()) {
      if (!shouldShowLauncherIdleItems(windowMode)) {
        return []
      }

      if (historyItems.length > 0) {
        return buildLauncherHistoryShellItems(copy, historyItems)
      }

      return buildLauncherLocalStartShellItems(copy, idleItems)
    }

    return [
      ...buildLauncherPluginIntentShellItems(
        getLauncherPluginIntents({
          copy,
          locale,
          query
        })
      ),
      ...buildLauncherSearchShellItems(copy, searchResults)
    ]
  }, [copy, historyItems, idleItems, locale, query, searchResults, windowMode])
  const selectedIndex = useMemo(() => {
    if (items.length === 0) {
      return -1
    }

    if (!selectedItemId) {
      return 0
    }

    const matchingIndex = items.findIndex((item) => item.id === selectedItemId)
    return matchingIndex >= 0 ? matchingIndex : 0
  }, [items, selectedItemId])
  const resultsViewportHeight = useMemo(() => {
    if (homeSurfaceMode === "history") {
      const columns = 8
      const rows = Math.ceil(items.length / columns)
      return rows * 70
    }

    return getLauncherResultsHeight(items.length, shellConfig)
  }, [homeSurfaceMode, items.length, shellConfig])
  const viewportHeight = useMemo(() => {
    if (resultsViewportHeight === 0) {
      return getLauncherViewportHeight(0, shellConfig)
    }

    return getLauncherViewportHeightForBody(resultsViewportHeight, shellConfig)
  }, [resultsViewportHeight, shellConfig])
  const resultsVisible = items.length > 0
  const entries = useMemo(() => getLauncherHomeEntries({ copy, locale }), [copy, locale])

  useEffect(() => {
    const refreshIdleState = (): void => {
      void Promise.all([
        window.api.settings.getLauncherSettings(),
        window.api.launcherHistory.list(),
        window.api.localStart.list()
      ]).then(([settings, launcherHistoryItems, localStartItems]) => {
        setWindowMode(settings.windowMode)
        setHistoryItems(launcherHistoryItems)
        setIdleItems(localStartItems)
      })
    }

    refreshIdleState()
    const cleanupShown = window.api.launcher.onShown(() => {
      refreshIdleState()
    })

    return () => {
      cleanupShown()
    }
  }, [])

  useEffect(() => {
    if (context.kind !== "text" || isTextAutofillConsumed) {
      return
    }

    if (query.trim().length > 0) {
      markTextAutofillConsumed()
      return
    }

    const text = context.text
    const frameId = window.requestAnimationFrame(() => {
      setQuery(text)
      markTextAutofillConsumed()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [context, isTextAutofillConsumed, markTextAutofillConsumed, query])

  useEffect(() => {
    if (!trimmedQuery) {
      latestSearchRequestRef.current += 1
      return
    }

    const debounceTimer = window.setTimeout(() => {
      const requestId = latestSearchRequestRef.current + 1
      latestSearchRequestRef.current = requestId

      void window.api.launcher
        .search({
          limit: MAX_LAUNCHER_SEARCH_RESULTS,
          query: trimmedQuery,
          sources: ["applications"]
        })
        .then((response) => {
          if (latestSearchRequestRef.current === requestId) {
            setSearchResponse(response)
          }
        })
        .catch(() => {
          if (latestSearchRequestRef.current === requestId) {
            setSearchResponse({
              query: trimmedQuery,
              results: []
            })
          }
        })
    }, 100)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [trimmedQuery])

  const openEntry = useCallback(
    (entry: LauncherHomeEntry, options?: LauncherPluginOpenOptions): void => {
      navigateToEntry(
        {
          entryId: entry.entryId,
          pluginId: entry.pluginId
        },
        {
          initialAction: options?.initialAction,
          seedQuery: options?.seedQuery ?? query
        }
      )
    },
    [navigateToEntry, query]
  )

  const moveSelection = useCallback(
    (delta: number): void => {
      if (items.length === 0) {
        return
      }

      const nextIndex = (selectedIndex + delta + items.length) % items.length
      setSelectedItemId(items[nextIndex]?.id ?? null)
    },
    [items, selectedIndex]
  )

  const executeItem = useCallback(
    (index: number): void => {
      const item = items[index]
      if (!item || item.availability === "planned") {
        return
      }

      if (item.pluginId && item.pluginEntryId) {
        navigateToEntry(
          {
            entryId: item.pluginEntryId,
            pluginId: item.pluginId
          },
          item.pluginOpenOptions ?? { seedQuery: query }
        )
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
    [items, navigateToEntry, query]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      const commandMatch = resolveLauncherPluginCommand({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        query,
        shiftKey: event.shiftKey
      })
      if (commandMatch) {
        event.preventDefault()
        navigateToEntry(
          {
            entryId: commandMatch.entryId,
            pluginId: commandMatch.pluginId
          },
          commandMatch.match.openOptions
        )
        return
      }

      switch (event.key) {
        case "Tab":
          event.preventDefault()
          navigateToEntry(DEFAULT_HOME_ENTRY, {
            initialAction: query.trim() ? "submit" : "focus",
            seedQuery: query
          })
          break
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault()
          moveSelection(1)
          break
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault()
          moveSelection(-1)
          break
        case "Enter":
          event.preventDefault()
          executeItem(selectedIndex)
          break
        default:
          break
      }
    },
    [executeItem, moveSelection, navigateToEntry, query, selectedIndex]
  )

  return {
    entries,
    executeItem,
    handleInputKeyDown,
    homeSurfaceMode,
    items,
    openEntry,
    placeholder: copy.launcher.searchPlaceholder,
    query,
    resultsViewportHeight,
    resultsVisible,
    selectedIndex,
    setQuery,
    shellConfig,
    viewportHeight
  }
}
