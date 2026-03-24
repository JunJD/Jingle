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
import { DEFAULT_HOME_ENTRY_PAGE_ID, launcherHomeEntries } from "../pages"
import type { LauncherFeaturePageId, LauncherHomeEntry } from "../pages/types"
import type { LauncherShellItem } from "../types"

const EMPTY_SEARCH_RESULTS: LauncherSearchResult[] = []

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

export function useLauncherSearchPage(props: {
  openFeaturePage: (
    pageId: LauncherFeaturePageId,
    options?: {
      seedQuery?: string
    }
  ) => void
}): {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  items: LauncherShellItem[]
  openFeaturePage: (pageId: LauncherFeaturePageId) => void
  placeholder: string
  query: string
  resultsViewportHeight: number
  resultsVisible: boolean
  selectedIndex: number
  setQuery: (value: string) => void
  viewportHeight: number
} {
  const { openFeaturePage: navigateToFeaturePage } = props
  const latestSearchRequestRef = useRef(0)
  const [query, setQueryState] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [shellConfig, setShellConfig] = useState<LauncherShellConfig>(FALLBACK_SHELL_CONFIG)
  const [searchResponse, setSearchResponse] = useState<LauncherSearchResponse | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const searchResults = searchResponse?.results ?? EMPTY_SEARCH_RESULTS
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
  const viewportHeight = getLauncherViewportHeight(items.length, shellConfig)
  const resultsVisible = items.length > 0

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
        limit: MAX_LAUNCHER_SEARCH_RESULTS,
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
  }, [debouncedQuery])

  const openFeaturePage = useCallback(
    (pageId: LauncherFeaturePageId): void => {
      navigateToFeaturePage(pageId, { seedQuery: query })
    },
    [navigateToFeaturePage, query]
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

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case "Tab":
          event.preventDefault()
          openFeaturePage(DEFAULT_HOME_ENTRY_PAGE_ID)
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
    [executeItem, moveSelection, openFeaturePage, selectedIndex]
  )

  return {
    entries: launcherHomeEntries,
    executeItem,
    handleInputKeyDown,
    items,
    openFeaturePage,
    placeholder: shellConfig.placeholder,
    query,
    resultsViewportHeight,
    resultsVisible,
    selectedIndex,
    setQuery,
    viewportHeight
  }
}
