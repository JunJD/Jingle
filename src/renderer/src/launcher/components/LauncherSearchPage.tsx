import type { RefObject } from "react"
import { Settings2 } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { formatLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { ClipboardContext } from "../../../../shared/clipboard"
import { LAUNCHER_COMMAND_IDS } from "../../../../shared/shortcuts/ids"
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
  const { copy, locale } = useI18n()
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
  const askAiShortcut = formatLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.searchOpenAi)
  const executeSelectionShortcut = formatLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.searchExecuteSelection
  )
  const headerLeading = previewClipboardContext ? (
    <ClipboardChip context={previewClipboardContext} onClear={onClearClipboardContext} />
  ) : undefined

  return (
    <LauncherChrome
      headerLeading={headerLeading}
      footer={
        resultsVisible ? (
          <>
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              <button
                type="button"
                onClick={() => {
                  void window.api.settings.openWindow()
                }}
                onMouseDown={(event) => event.preventDefault()}
                className="launcher-icon-button flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                title={locale === "zh-CN" ? "打开设置" : "Open settings"}
                aria-label={locale === "zh-CN" ? "打开设置" : "Open settings"}
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <span>{copy.launcher.searchResults}</span>
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
              className="launcher-action-link flex appearance-none items-center gap-2 rounded-[10px] border-0 px-3 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-50"
            >
              <span>{primaryActionLabel}</span>
              {executeSelectionShortcut ? (
                <span className="launcher-shortcut text-[11px] text-muted-foreground">
                  {executeSelectionShortcut}
                </span>
              ) : null}
            </button>
          </>
        ) : undefined
      }
      headerTrailing={
        <div className="flex shrink-0 items-center gap-2 px-0 py-1 text-[13px] font-medium text-muted-foreground">
          {askAiShortcut ? (
            <span className="launcher-shortcut text-[11px] text-muted-foreground">
              {askAiShortcut}
            </span>
          ) : null}
          <span>{copy.launcher.aiEntryLabel}</span>
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
