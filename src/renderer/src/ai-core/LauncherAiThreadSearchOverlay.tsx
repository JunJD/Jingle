import { MessageSquare, Search } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import type { LauncherSearchResult } from "@shared/launcher-search"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

interface LauncherAiThreadSearchOverlayProps {
  activeIndex: number
  currentThreadId: string | null
  isLoading: boolean
  labels: {
    search: string
    searchLoading: string
    searchNoResults: string
  }
  onActiveIndexChange: (index: number) => void
  onClose: () => void
  onQueryChange: (query: string) => void
  onSelectThread: (threadId: string) => void
  query: string
  results: readonly LauncherSearchResult[]
}

function getResultThreadId(result: LauncherSearchResult): string | null {
  return result.action.type === "open-history-thread" ? result.action.target.threadId : null
}

export function LauncherAiThreadSearchOverlay(
  props: LauncherAiThreadSearchOverlayProps
): React.JSX.Element {
  const {
    activeIndex,
    currentThreadId,
    isLoading,
    labels,
    onActiveIndexChange,
    onClose,
    onQueryChange,
    onSelectThread,
    query,
    results
  } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const trimmedQuery = query.trim()
  const activeResult = results[activeIndex] ?? null
  const activeThreadId = activeResult ? getResultThreadId(activeResult) : null
  const visibleState = useMemo(() => {
    if (!trimmedQuery) {
      return "idle"
    }

    if (isLoading) {
      return "loading"
    }

    return results.length > 0 ? "results" : "empty"
  }, [isLoading, results.length, trimmedQuery])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }

    inputRef.current?.focus()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-label={labels.search}
      className="launcher-ai-thread-search"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="launcher-ai-thread-search__panel">
        <div className="launcher-ai-thread-search__input-row">
          <Search className="launcher-ai-thread-search__input-icon" aria-hidden="true" />
          <Input
            ref={inputRef}
            aria-label={labels.search}
            className="launcher-ai-thread-search__input"
            placeholder={labels.search}
            type="search"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
              }

              if (event.key === "ArrowDown") {
                event.preventDefault()
                if (results.length > 0) {
                  onActiveIndexChange((activeIndex + 1) % results.length)
                }
                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                if (results.length > 0) {
                  onActiveIndexChange((activeIndex - 1 + results.length) % results.length)
                }
                return
              }

              if (event.key === "Enter" && activeThreadId) {
                event.preventDefault()
                onSelectThread(activeThreadId)
              }
            }}
          />
        </div>

        <div className="launcher-ai-thread-search__body">
          {visibleState === "loading" ? (
            <div className="launcher-ai-thread-search__status">
              <Spinner className="launcher-ai-thread-search__spinner" size="sm" />
              <span>{labels.searchLoading}</span>
            </div>
          ) : null}
          {visibleState === "empty" ? (
            <div className="launcher-ai-thread-search__status">{labels.searchNoResults}</div>
          ) : null}
          {visibleState === "results" ? (
            <div className="launcher-ai-thread-search__results">
              {results.map((result, index) => {
                const resultThreadId = getResultThreadId(result)
                const isActive = index === activeIndex
                const isCurrent = resultThreadId === currentThreadId

                return (
                  <Button
                    key={`${result.source}:${result.id}`}
                    className="launcher-ai-thread-search__result"
                    data-active={isActive ? "" : undefined}
                    data-current={isCurrent ? "" : undefined}
                    type="button"
                    aria-current={isCurrent ? "page" : undefined}
                    onMouseEnter={() => onActiveIndexChange(index)}
                    onClick={() => {
                      if (resultThreadId) {
                        onSelectThread(resultThreadId)
                      }
                    }}
                    variant="ghost"
                  >
                    <span className="launcher-ai-thread-search__result-icon">
                      <MessageSquare aria-hidden="true" />
                    </span>
                    <span className="launcher-ai-thread-search__result-copy">
                      <span className="launcher-ai-thread-search__result-title">
                        {result.title}
                      </span>
                      <span className="launcher-ai-thread-search__result-subtitle">
                        {result.subtitle}
                      </span>
                    </span>
                  </Button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  )
}
