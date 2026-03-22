import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  MAX_LAUNCHER_SEARCH_RESULTS,
  getLauncherResultsHeight,
  getLauncherViewportHeight,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import type {
  LauncherSearchResponse,
  LauncherSearchResult
} from "../../../../shared/launcher-search"
import {
  DEFAULT_LAUNCHER_SECONDARY_PAGE_ID,
  getLauncherSecondaryPageDefinition,
  launcherSecondaryPages
} from "../pages"
import type {
  LauncherNavigationDirection,
  LauncherSecondaryPageDefinition,
  LauncherSecondaryPageId
} from "../pages/types"
import type { LauncherShellItem } from "../types"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []

export type LauncherViewMode = "search" | "detail"

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

export function useLauncherShell(): {
  activeSecondaryPage: LauncherSecondaryPageDefinition | null
  closeSecondaryPage: () => void
  detailQuery: string
  executeItem: (index: number) => void
  handleDetailInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  items: LauncherShellItem[]
  mode: LauncherViewMode
  navigationDirection: LauncherNavigationDirection
  openSecondaryPage: (pageId: LauncherSecondaryPageId) => void
  pageEntries: LauncherSecondaryPageDefinition[]
  placeholder: string
  query: string
  resultsVisible: boolean
  selectedIndex: number
  setDetailQuery: (value: string) => void
  resultsViewportHeight: number
  setQuery: (value: string) => void
  setSelectedIndex: (value: number) => void
  syncViewportHeight: () => void
} {
  const latestSearchRequestRef = useRef(0)
  const [activeSecondaryPageId, setActiveSecondaryPageId] =
    useState<LauncherSecondaryPageId | null>(null)
  const [query, setQueryState] = useState("")
  const [secondaryPageQueries, setSecondaryPageQueries] = useState<
    Partial<Record<LauncherSecondaryPageId, string>>
  >({})
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [shellConfig, setShellConfig] = useState<LauncherShellConfig>(FALLBACK_SHELL_CONFIG)
  const [searchResponse, setSearchResponse] = useState<LauncherSearchResponse | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const searchResults = searchResponse?.results ?? EMPTY_SEARCH_RESULTS
  const searchLimit = MAX_LAUNCHER_SEARCH_RESULTS
  const activeSecondaryPage = activeSecondaryPageId
    ? getLauncherSecondaryPageDefinition(activeSecondaryPageId)
    : null
  const mode: LauncherViewMode = activeSecondaryPage ? "detail" : "search"
  const detailQuery = activeSecondaryPageId
    ? (secondaryPageQueries[activeSecondaryPageId] ?? "")
    : ""

  const items = useMemo(() => buildLauncherShellItems(searchResults), [searchResults])
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

  useEffect(() => {
    let isMounted = true

    void window.api.launcher
      .getShellConfig()
      .then((config) => {
        if (isMounted) {
          setShellConfig(config)
        }
      })
      .catch(() => {
        // Fall back to local defaults if the main-process shell config is unavailable.
      })

    return () => {
      isMounted = false
    }
  }, [])

  const setQuery = useCallback((value: string): void => {
    setQueryState(value)

    if (!value.trim()) {
      latestSearchRequestRef.current += 1
      setDebouncedQuery("")
      setSearchResponse(null)
      setSelectedItemId(null)
    }
  }, [])

  const setDetailQuery = useCallback(
    (value: string): void => {
      if (!activeSecondaryPageId) {
        return
      }

      setSecondaryPageQueries((previous) => ({
        ...previous,
        [activeSecondaryPageId]: value
      }))
    },
    [activeSecondaryPageId]
  )

  const openSecondaryPage = useCallback(
    (pageId: LauncherSecondaryPageId): void => {
      setNavigationDirection("forward")
      setSecondaryPageQueries((previous) => ({
        ...previous,
        [pageId]: query.trim()
      }))
      setActiveSecondaryPageId(pageId)
    },
    [query]
  )

  const closeSecondaryPage = useCallback((): void => {
    setNavigationDirection("backward")
    setActiveSecondaryPageId(null)
  }, [])

  useEffect(() => {
    const nextQuery = query.trim()
    if (!nextQuery) {
      return
    }

    const debounceTimer = window.setTimeout(() => {
      setDebouncedQuery(nextQuery)
    }, 100)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [query])

  useEffect(() => {
    if (!debouncedQuery) {
      return
    }

    const requestId = latestSearchRequestRef.current + 1
    latestSearchRequestRef.current = requestId

    void window.api.launcher
      .search({
        limit: searchLimit,
        query: debouncedQuery,
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
            query: debouncedQuery,
            results: []
          })
        }
      })
  }, [debouncedQuery, searchLimit])

  const resultsVisible = mode === "search" && items.length > 0

  const syncViewportHeight = useCallback(() => {
    const nextHeight = activeSecondaryPage
      ? activeSecondaryPage.getViewportHeight(shellConfig)
      : getLauncherViewportHeight(items.length, shellConfig)
    void window.api.launcher.setViewportHeight(nextHeight)
  }, [activeSecondaryPage, items.length, shellConfig])

  useEffect(() => {
    syncViewportHeight()
  }, [syncViewportHeight])

  const moveSelection = (delta: number): void => {
    if (items.length === 0) {
      return
    }

    const nextIndex = (selectedIndex + delta + items.length) % items.length
    setSelectedItemId(items[nextIndex]?.id ?? null)
  }

  const setSelectedIndex = (value: number): void => {
    if (items.length === 0) {
      setSelectedItemId(null)
      return
    }

    const nextIndex = Math.min(Math.max(value, 0), items.length - 1)
    setSelectedItemId(items[nextIndex]?.id ?? null)
  }

  const executeItem = useCallback(
    (index: number): void => {
      const item = items[index]
      if (!item || item.availability === "planned" || item.action.type === "none") {
        return
      }

      void window.api.launcher.executeAction(item.action).then((result) => {
        if (!result.ok) {
          console.warn("[Launcher] Failed to execute action:", result.error)
        }
      })
    },
    [items]
  )

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "Tab":
        event.preventDefault()
        openSecondaryPage(DEFAULT_LAUNCHER_SECONDARY_PAGE_ID)
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
  }

  const handleDetailInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "Escape":
        event.preventDefault()
        closeSecondaryPage()
        break
      case "Backspace":
        if (!detailQuery && activeSecondaryPage?.closeOnEmptyBackspace) {
          event.preventDefault()
          closeSecondaryPage()
        }
        break
      default:
        break
    }
  }

  return {
    activeSecondaryPage,
    closeSecondaryPage,
    detailQuery,
    executeItem,
    handleDetailInputKeyDown,
    handleInputKeyDown,
    items,
    mode,
    navigationDirection,
    openSecondaryPage,
    pageEntries: launcherSecondaryPages,
    placeholder: shellConfig.placeholder,
    query,
    resultsVisible,
    selectedIndex,
    setDetailQuery,
    resultsViewportHeight,
    setQuery,
    setSelectedIndex,
    syncViewportHeight
  }
}
