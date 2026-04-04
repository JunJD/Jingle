import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
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
import { sortLauncherHistoryItems } from "../../../../shared/launcher-history"
import type { LocalStartItem } from "../../../../shared/local-start"
import { DEFAULT_HOME_COMMAND, resolveLauncherPluginCommand } from "../pages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  resolveLauncherHomeSurfaceSelectedIndex,
  type LauncherHomeSurfaceModel
} from "../home-surface"
import type { LauncherCommandAddress, LauncherPluginOpenOptions } from "../pages/types"
import { useLauncherHomeClipboard } from "./useLauncherHomeClipboard"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []

export function useLauncherSearchPage(props: {
  openCommand: (address: LauncherCommandAddress, options?: LauncherPluginOpenOptions) => void
}): {
  executeItem: (index: number) => void
  clearClipboardContext: () => void
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  homeInputSelectionRequestVersion: number
  removeHistoryItem: (itemId: string) => void
  setHistoryItemPinned: (itemId: string, pin: boolean) => void
  placeholder: string
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
  const [searchResponse, setSearchResponse] = useState<LauncherSearchResponse | null>(null)
  const [idleItems, setIdleItems] = useState<LocalStartItem[]>([])
  const [windowMode, setWindowMode] = useState<"default" | "compact">("default")
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [homeInputSelectionRequestVersion, setHomeInputSelectionRequestVersion] = useState(0)
  const shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
  const trimmedQuery = query.trim()

  const searchResults =
    trimmedQuery && searchResponse?.query === trimmedQuery
      ? searchResponse.results
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

      void window.api.launcher
        .search({
          limit: MAX_LAUNCHER_SEARCH_RESULTS,
          query: trimmedQuery
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
        navigateToCommand(
          {
            kind: "internal-plugin",
            commandName: commandMatch.commandName,
            pluginId: commandMatch.pluginId
          },
          commandMatch.match.openOptions
        )
        return
      }

      switch (event.key) {
        case "Tab":
          event.preventDefault()
          navigateToCommand(DEFAULT_HOME_COMMAND, {
            initialAction: query.trim() ? "submit" : "focus",
            seedQuery: query
          })
          break
        case "ArrowDown":
          event.preventDefault()
          moveSelection(1)
          break
        case "ArrowUp":
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
    [executeItem, moveSelection, navigateToCommand, query, selectedIndex]
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
    handleInputKeyDown,
    homeInputSelectionRequestVersion,
    previewClipboardContext: homeClipboard.previewContext,
    removeHistoryItem,
    setHistoryItemPinned,
    placeholder: copy.launcher.searchPlaceholder,
    query,
    resultsViewportHeight,
    selectedIndex,
    setQuery,
    shellConfig,
    surface,
    viewportHeight
  }
}
