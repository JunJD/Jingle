import type { RefObject } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "../../../../plugins/ai/manifest"
import { useI18n } from "@/lib/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import { useLauncherClipboard } from "../LauncherClipboardContext"
import type { LauncherHomeEntry, LauncherPluginOpenOptions } from "../pages/types"
import type { LauncherShellItem } from "../types"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherHistoryGrid } from "./LauncherHistoryGrid"
import { LauncherResultList } from "./LauncherResultList"

export function LauncherSearchPage(props: {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  homeSurfaceMode: "history" | "idle" | "results"
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  items: LauncherShellItem[]
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  onOpenEntry: (entry: LauncherHomeEntry, options?: LauncherPluginOpenOptions) => void
  onRemoveHistoryItem: (itemId: string) => void
  onSetHistoryItemPinned: (itemId: string, pin: boolean) => void
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
    homeSurfaceMode,
    inputRef,
    inputValue,
    items,
    onInputKeyDown,
    onInputValueChange,
    onOpenEntry,
    onRemoveHistoryItem,
    onSetHistoryItemPinned,
    placeholder,
    resultsViewportHeight,
    resultsVisible,
    selectedIndex,
    selectedItem,
    shellConfig
  } = props

  const primaryActionLabel =
    selectedItem?.presentation.primaryActionLabel ?? copy.launcher.openGeneric
  const isPrimaryActionDisabled = !selectedItem || selectedItem.availability === "planned"
  const hasQuery = inputValue.trim().length > 0
  const showHistoryGrid = homeSurfaceMode === "history"
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
              disabled={isPrimaryActionDisabled}
              className="launcher-action-link flex appearance-none items-center gap-2 border-0 px-0 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-50"
            >
              <span>{primaryActionLabel}</span>
              <span className="launcher-shortcut text-[11px] text-muted-foreground">↵</span>
            </button>
          </>
        ) : undefined
      }
      headerTrailing={entries.map((entry) => (
        <button
          key={`${entry.pluginId}:${entry.entryId}`}
          type="button"
          onClick={() =>
            onOpenEntry(
              entry,
              entry.pluginId === AI_LAUNCHER_PLUGIN_ID && hasQuery
                ? { initialAction: "submit" }
                : undefined
            )
          }
          onMouseDown={(event) => event.preventDefault()}
          className="launcher-header-button flex shrink-0 appearance-none items-center gap-2 border-0 px-0 py-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <span>
            {entry.pluginId === AI_LAUNCHER_PLUGIN_ID && hasQuery
              ? copy.launcher.askAiWithTab
              : entry.label}
          </span>
          {entry.shortcutLabel && !(entry.pluginId === AI_LAUNCHER_PLUGIN_ID && hasQuery) ? (
            <span className="launcher-shortcut text-[11px] text-muted-foreground">
              {entry.shortcutLabel}
            </span>
          ) : null}
        </button>
      ))}
      inputRef={inputRef}
      inputValue={inputValue}
      onInputKeyDown={onInputKeyDown}
      onInputValueChange={onInputValueChange}
      placeholder={placeholder}
      shellConfig={shellConfig}
      showHeaderDivider={resultsVisible}
      surface="home"
    >
      {showHistoryGrid ? (
        <LauncherHistoryGrid
          items={items}
          onExecute={executeItem}
          onRemove={onRemoveHistoryItem}
          onSetPinned={onSetHistoryItemPinned}
          selectedIndex={selectedIndex}
        />
      ) : (
        <LauncherResultList
          height={resultsViewportHeight}
          items={items}
          onExecute={executeItem}
          selectedIndex={selectedIndex}
        />
      )}
    </LauncherChrome>
  )
}
