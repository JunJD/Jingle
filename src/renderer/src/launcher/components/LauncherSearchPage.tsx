import type { RefObject } from "react"
import { useI18n } from "@/lib/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { LauncherShellItem } from "../types"
import type { LauncherHomeEntry } from "../pages/types"
import { useLauncherClipboard } from "../LauncherClipboardContext"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherResultList } from "./LauncherResultList"

export function LauncherSearchPage(props: {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  inputRef: RefObject<HTMLInputElement | null>
  items: LauncherShellItem[]
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onOpenFeaturePage: (pageId: LauncherHomeEntry["pageId"]) => void
  placeholder: string
  resultsViewportHeight: number
  resultsVisible: boolean
  selectedIndex: number
  selectedItem: LauncherShellItem | null
  shellConfig: LauncherShellConfig
}): React.JSX.Element {
  const { copy } = useI18n()
  const clipboard = useLauncherClipboard()
  const {
    entries,
    executeItem,
    inputRef,
    items,
    onInputKeyDown,
    onOpenFeaturePage,
    placeholder,
    resultsViewportHeight,
    resultsVisible,
    selectedIndex,
    selectedItem,
    shellConfig
  } = props

  const primaryActionLabel =
    selectedItem?.featurePageId || selectedItem?.kind === "ai"
      ? copy.launcher.aiPrimaryLabel
      : selectedItem?.kind === "application"
        ? copy.launcher.openApp
        : copy.launcher.openGeneric
  const headerLeading =
    clipboard.context.kind === "files" || clipboard.context.kind === "image" ? (
      <ClipboardChip context={clipboard.context} onClear={clipboard.clearContext} />
    ) : undefined

  return (
    <LauncherChrome
      headerLeading={headerLeading}
      footer={
        resultsVisible ? (
          <>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {copy.launcher.searchResults}
            </div>

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
              className="flex appearance-none items-center gap-3 rounded-full border-0 bg-transparent px-2 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-50"
            >
              <span>{primaryActionLabel}</span>
              <span
                className="rounded-full bg-[var(--launcher-surface-strong)] px-2.5 py-1 text-[11px] text-muted-foreground"
                style={{
                  color: "var(--launcher-text-muted)"
                }}
              >
                ↵
              </span>
            </button>
          </>
        ) : undefined
      }
      headerTrailing={entries.map((entry) => (
        <button
          key={entry.pageId}
          type="button"
          onClick={() => onOpenFeaturePage(entry.pageId)}
          onMouseDown={(event) => event.preventDefault()}
          className="flex shrink-0 appearance-none items-center gap-2 border-0 bg-transparent px-0 py-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <span>{entry.label}</span>
          <span
            className="rounded-full bg-[var(--launcher-surface-strong)] px-2.5 py-1 text-[11px] text-muted-foreground"
            style={{
              color: "var(--launcher-text-muted)"
            }}
          >
            {entry.shortcutLabel}
          </span>
        </button>
      ))}
      inputRef={inputRef}
      onInputKeyDown={onInputKeyDown}
      placeholder={placeholder}
      shellConfig={shellConfig}
      showHeaderDivider={resultsVisible}
      surface="home"
    >
      <LauncherResultList
        height={resultsViewportHeight}
        items={items}
        onExecute={executeItem}
        selectedIndex={selectedIndex}
      />
    </LauncherChrome>
  )
}
