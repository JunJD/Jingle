import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherResultsHeight,
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
import { DEFAULT_HOME_ENTRY_PLUGIN_ID, getLauncherHomeEntries } from "../pages"
import type { LauncherHomeEntry, LauncherPluginId } from "../pages/types"
import type { LauncherShellItem } from "../types"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []

function buildFeatureIntentItems(props: {
  aiEntryLabel: string
  aiIntentSubtitle: (query: string) => string
  query: string
}): LauncherShellItem[] {
  const { aiEntryLabel, aiIntentSubtitle, query } = props
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  return [
    {
      action: { type: "none" },
      pluginId: "ai",
      id: "feature-ai-intent",
      kind: "ai",
      subtitle: aiIntentSubtitle(trimmedQuery),
      title: aiEntryLabel
    }
  ]
}

function buildLauncherShellItems(searchResults: LauncherSearchResult[]): LauncherShellItem[] {
  return searchResults.map((result) => ({
    action: result.action,
    availability: result.availability,
    id: result.id,
    iconDataUrl: result.iconDataUrl,
    kind: result.kind,
    match: result.match,
    subtitle: result.subtitle,
    title: result.title
  }))
}

function buildLocalStartShellItems(items: LocalStartItem[]): LauncherShellItem[] {
  return items.map((item) => ({
    action: {
      type: "open-local-start-item",
      itemId: item.id,
      itemKind: item.kind,
      path: item.path
    },
    id: item.id,
    kind: item.kind,
    subtitle: item.path,
    title: item.title
  }))
}

function buildLauncherHistoryShellItems(items: LauncherHistoryItem[]): LauncherShellItem[] {
  return items.map((item) => ({
    action: item.action,
    id: item.id,
    kind: item.kind,
    subtitle: item.subtitle,
    title: item.title
  }))
}

export function useLauncherSearchPage(props: {
  openPlugin: (pluginId: LauncherPluginId, options?: { seedQuery?: string }) => void
}): {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  items: LauncherShellItem[]
  openPlugin: (pluginId: LauncherPluginId) => void
  placeholder: string
  query: string
  resultsViewportHeight: number
  resultsVisible: boolean
  selectedIndex: number
  setQuery: (value: string) => void
  shellConfig: LauncherShellConfig
  viewportHeight: number
} {
  const { openPlugin: navigateToPlugin } = props
  const { copy } = useI18n()
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
  const items = useMemo(() => {
    if (!query.trim()) {
      if (!shouldShowLauncherIdleItems(windowMode)) {
        return []
      }

      if (historyItems.length > 0) {
        return buildLauncherHistoryShellItems(historyItems)
      }

      return buildLocalStartShellItems(idleItems)
    }

    return [
      ...buildFeatureIntentItems({
        aiEntryLabel: copy.launcher.aiEntryLabel,
        aiIntentSubtitle: copy.launcher.aiIntentSubtitle,
        query
      }),
      ...buildLauncherShellItems(searchResults)
    ]
  }, [
    copy.launcher.aiEntryLabel,
    copy.launcher.aiIntentSubtitle,
    historyItems,
    idleItems,
    query,
    searchResults,
    windowMode
  ])
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
  const resultsViewportHeight = getLauncherResultsHeight(items.length, shellConfig)
  const viewportHeight = getLauncherViewportHeight(items.length, shellConfig)
  const resultsVisible = items.length > 0
  const entries = useMemo(() => getLauncherHomeEntries(copy), [copy])

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

  const openPlugin = useCallback(
    (pluginId: LauncherPluginId): void => {
      navigateToPlugin(pluginId, { seedQuery: query })
    },
    [navigateToPlugin, query]
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

      if (item.pluginId) {
        navigateToPlugin(item.pluginId, { seedQuery: query })
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
    [items, navigateToPlugin, query]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case "Tab":
          event.preventDefault()
          openPlugin(DEFAULT_HOME_ENTRY_PLUGIN_ID)
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
    [executeItem, moveSelection, openPlugin, selectedIndex]
  )

  return {
    entries,
    executeItem,
    handleInputKeyDown,
    items,
    openPlugin,
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
