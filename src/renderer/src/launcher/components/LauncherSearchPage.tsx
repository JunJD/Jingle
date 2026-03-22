import type { RefObject } from "react"
import type { LauncherShellItem } from "../types"
import type { LauncherSecondaryPageDefinition } from "../pages/types"
import { LauncherResultList } from "./LauncherResultList"

export function LauncherSearchPage(props: {
  executeItem: (index: number) => void
  inputRef: RefObject<HTMLInputElement | null>
  items: LauncherShellItem[]
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onOpenPage: (pageId: LauncherSecondaryPageDefinition["id"]) => void
  pageEntries: LauncherSecondaryPageDefinition[]
  placeholder: string
  query: string
  resultsViewportHeight: number
  resultsVisible: boolean
  selectedIndex: number
  selectedItem: LauncherShellItem | null
  setQuery: (value: string) => void
}): React.JSX.Element {
  const {
    executeItem,
    inputRef,
    items,
    onInputKeyDown,
    onOpenPage,
    pageEntries,
    placeholder,
    query,
    resultsViewportHeight,
    resultsVisible,
    selectedIndex,
    selectedItem,
    setQuery
  } = props

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex h-[60px] shrink-0 items-center pl-6 pr-8"
        style={{ borderBottom: "1px solid var(--launcher-border)" }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="h-full flex-1 border-0 bg-transparent px-0 text-[16px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />

        <div className="ml-4 flex shrink-0 items-center gap-4">
          {pageEntries.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => onOpenPage(page.id)}
              onMouseDown={(event) => event.preventDefault()}
              className="flex shrink-0 appearance-none items-center gap-3 rounded-md border-0 bg-transparent px-0 py-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              <span>{page.entry.label}</span>
              <span
                className="rounded-[10px] px-2 py-1 text-[12px]"
                style={{
                  border: "1px solid var(--launcher-border-strong)",
                  backgroundColor: "var(--launcher-surface-strong)",
                  color: "var(--launcher-text)"
                }}
              >
                {page.entry.shortcutLabel}
              </span>
            </button>
          ))}
        </div>
      </div>

      <LauncherResultList
        height={resultsViewportHeight}
        items={items}
        onExecute={executeItem}
        selectedIndex={selectedIndex}
      />

      {resultsVisible ? (
        <div
          className="flex h-[48px] shrink-0 items-center justify-between pl-4 pr-8"
          style={{
            borderTop: "1px solid var(--launcher-border)",
            backgroundColor: "color-mix(in srgb, var(--launcher-surface-strong) 42%, transparent)"
          }}
        >
          <div className="px-2 py-1 text-[13px] text-muted-foreground">Search Results</div>

          <button
            type="button"
            onClick={() => {
              if (!selectedItem) {
                return
              }

              executeItem(selectedIndex)
            }}
            onMouseDown={(event) => event.preventDefault()}
            disabled={!selectedItem}
            className="flex appearance-none items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-50"
          >
            <span>{selectedItem?.kind === "application" ? "Open App" : "Open Result"}</span>
            <span
              className="rounded-[10px] px-2 py-1 text-[12px]"
              style={{
                border: "1px solid var(--launcher-border-strong)",
                backgroundColor: "var(--launcher-surface-strong)",
                color: "var(--launcher-text)"
              }}
            >
              ↵
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
