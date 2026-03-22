import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  FALLBACK_SHELL_CONFIG,
  getLauncherViewportHeight,
  type LauncherResultItem,
  type LauncherShellConfig
} from "../../../../shared/launcher"

function clampSelectedIndex(index: number, itemCount: number): number {
  if (itemCount === 0) {
    return -1
  }

  if (index < 0) {
    return 0
  }

  return Math.min(index, itemCount - 1)
}

function buildLauncherShellItems(query: string): LauncherResultItem[] {
  if (!query) {
    return [
      {
        id: "planned-app-search",
        kind: "application",
        title: "Search Installed Apps",
        subtitle: "Application Search",
        trailingLabel: "Command"
      },
      {
        id: "planned-ai-route",
        kind: "ai",
        title: "Ask AI",
        subtitle: "Openwork AI",
        trailingLabel: "Tab"
      },
      {
        id: "planned-history",
        kind: "history",
        title: "Open Quicklink",
        subtitle: "Launcher Action",
        trailingLabel: "Quicklink"
      }
    ]
  }

  return [
    {
      id: "preview-app-search",
      kind: "application",
      title: `Search apps for "${query}"`,
      subtitle: "Application Search",
      trailingLabel: "Command"
    },
    {
      id: "preview-ai-route",
      kind: "ai",
      title: `Ask AI about "${query}"`,
      subtitle: "Openwork AI",
      trailingLabel: "Tab"
    },
    {
      id: "preview-quicklink",
      kind: "history",
      title: `Open quicklink for "${query}"`,
      subtitle: "Launcher Action",
      trailingLabel: "Quicklink"
    }
  ]
}

export function useLauncherShell(): {
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  items: LauncherResultItem[]
  placeholder: string
  query: string
  selectedIndex: number
  selectAiRoute: () => void
  setQuery: (value: string) => void
  setSelectedIndex: (value: number) => void
  syncViewportHeight: () => void
} {
  const [query, setQuery] = useState("")
  const [shellConfig, setShellConfig] = useState<LauncherShellConfig>(FALLBACK_SHELL_CONFIG)
  const [selectedIndexState, setSelectedIndexState] = useState(0)
  const deferredQuery = useDeferredValue(query.trim())

  const items = useMemo(() => buildLauncherShellItems(deferredQuery), [deferredQuery])
  const selectedIndex = clampSelectedIndex(selectedIndexState, items.length)

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

  const syncViewportHeight = useCallback(() => {
    const nextHeight = getLauncherViewportHeight(items.length, shellConfig)
    void window.api.launcher.setViewportHeight(nextHeight)
  }, [items.length, shellConfig])

  useEffect(() => {
    syncViewportHeight()
  }, [syncViewportHeight])

  const moveSelection = (delta: number): void => {
    setSelectedIndexState((current) => {
      const normalizedIndex = clampSelectedIndex(current, items.length)

      if (normalizedIndex < 0) {
        return 0
      }

      return (normalizedIndex + delta + items.length) % items.length
    })
  }

  const selectAiRoute = (): void => {
    const aiItemIndex = items.findIndex((item) => item.kind === "ai")
    if (aiItemIndex >= 0) {
      setSelectedIndexState(aiItemIndex)
    }
  }

  const setSelectedIndex = (value: number): void => {
    setSelectedIndexState(clampSelectedIndex(value, items.length))
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
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
        break
      case "Tab":
        event.preventDefault()
        selectAiRoute()
        break
      default:
        break
    }
  }

  return {
    handleInputKeyDown,
    items,
    placeholder: shellConfig.placeholder,
    query,
    selectedIndex,
    selectAiRoute,
    setQuery,
    setSelectedIndex,
    syncViewportHeight
  }
}
