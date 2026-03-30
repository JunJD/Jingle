import type { RefObject } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "../../../../plugins/ai/manifest"
import { useI18n } from "@/lib/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { ClipboardContext } from "../../../../shared/clipboard"
import type { LauncherHomeSurfaceModel } from "../home-surface"
import type { LauncherHomeEntry, LauncherPluginOpenOptions } from "../pages/types"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherHistoryGrid } from "./LauncherHistoryGrid"
import { LauncherResultList } from "./LauncherResultList"

export function LauncherSearchPage(props: {
  entries: LauncherHomeEntry[]
  executeItem: (index: number) => void
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  onClearClipboardContext: () => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  onOpenEntry: (entry: LauncherHomeEntry, options?: LauncherPluginOpenOptions) => void
  onRemoveHistoryItem: (itemId: string) => void
  onSetHistoryItemPinned: (itemId: string, pin: boolean) => void
  placeholder: string
  previewClipboardContext: Extract<ClipboardContext, { kind: "files" | "image" }> | null
  resultsViewportHeight: number
  selectedIndex: number
  shellConfig: LauncherShellConfig
  surface: LauncherHomeSurfaceModel
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    entries,
    executeItem,
    inputRef,
    inputValue,
    onClearClipboardContext,
    onInputKeyDown,
    onInputValueChange,
    onOpenEntry,
    onRemoveHistoryItem,
    onSetHistoryItemPinned,
    placeholder,
    previewClipboardContext,
    resultsViewportHeight,
    selectedIndex,
    shellConfig,
    surface
  } = props
  const selectedItem = selectedIndex >= 0 ? surface.items[selectedIndex] : null

  const primaryActionLabel =
    selectedItem?.presentation.primaryActionLabel ?? copy.launcher.openGeneric
  const isPrimaryActionDisabled = !selectedItem || selectedItem.availability === "planned"
  const hasQuery = inputValue.trim().length > 0
  const resultsVisible = surface.chrome.footerVisible
  const showHistoryGrid = surface.body.kind === "history-grid"
  const headerLeading = previewClipboardContext ? (
    <ClipboardChip context={previewClipboardContext} onClear={onClearClipboardContext} />
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
      showHeaderDivider={surface.chrome.headerDividerVisible}
      surface="home"
    >
      {showHistoryGrid ? (
        <LauncherHistoryGrid
          items={surface.items}
          onExecute={executeItem}
          onRemove={onRemoveHistoryItem}
          onSetPinned={onSetHistoryItemPinned}
          selectedIndex={selectedIndex}
        />
      ) : (
        <LauncherResultList
          height={resultsViewportHeight}
          onExecute={executeItem}
          sections={surface.sections}
          selectedIndex={selectedIndex}
        />
      )}
    </LauncherChrome>
  )
}
