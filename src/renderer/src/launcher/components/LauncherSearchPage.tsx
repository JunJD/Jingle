import type { RefObject } from "react"
import { useI18n } from "@/lib/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { ClipboardContext } from "../../../../shared/clipboard"
import type { LauncherHomeSurfaceModel } from "../home-surface"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherHistoryGrid } from "./LauncherHistoryGrid"
import { LauncherResultList } from "./LauncherResultList"

export function LauncherSearchPage(props: {
  executeItem: (index: number) => void
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  onClearClipboardContext: () => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
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
    executeItem,
    inputRef,
    inputValue,
    onClearClipboardContext,
    onInputKeyDown,
    onInputValueChange,
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
      headerTrailing={
        <div className="flex shrink-0 items-center px-0 py-1 text-[13px] font-medium text-muted-foreground">
          {copy.launcher.askAiWithTab}
        </div>
      }
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
