import { useCallback, useMemo, type RefObject } from "react"
import { Loader2, Settings2 } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import type { LauncherShellConfig } from "@shared/launcher"
import type { ClipboardContext } from "@shared/clipboard"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { LauncherHomeSurfaceModel } from "@launcher-shell/home-surface"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherHistoryGrid } from "./LauncherHistoryGrid"
import { LauncherResultList } from "./LauncherResultList"

const HOME_SHORTCUT_SCOPES = ["launcher.home"] as const
type LauncherHomeCommandId =
  | typeof LAUNCHER_COMMAND_IDS.searchOpenAi
  | typeof LAUNCHER_COMMAND_IDS.searchOpenSettings
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionDown
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionUp
  | typeof LAUNCHER_COMMAND_IDS.searchExecuteSelection

export function LauncherSearchPage(props: {
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  executeItem: (index: number) => void
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  isSearchLoading: boolean
  onClearClipboardContext: () => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  onRemoveHistoryItem: (itemId: string) => void
  onSetHistoryItemPinned: (itemId: string, pin: boolean) => void
  previewClipboardContext: Extract<ClipboardContext, { kind: "files" | "image" }> | null
  resultsViewportHeight: number
  selectedIndex: number
  shellConfig: LauncherShellConfig
  surface: LauncherHomeSurfaceModel
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    executeHomeCommand,
    executeItem,
    inputRef,
    inputValue,
    isSearchLoading,
    onClearClipboardContext,
    onInputKeyDown,
    onInputValueChange,
    onRemoveHistoryItem,
    onSetHistoryItemPinned,
    previewClipboardContext,
    resultsViewportHeight,
    selectedIndex,
    shellConfig,
    surface
  } = props
  useShortcutScopeLayer(HOME_SHORTCUT_SCOPES)
  const selectedItem = selectedIndex >= 0 ? surface.items[selectedIndex] : null
  const isInputShortcutTarget = useCallback(
    (target: EventTarget | null): boolean => target === inputRef.current,
    [inputRef]
  )
  const handleOpenAiShortcut = useCallback(
    (event: KeyboardEvent): void => {
      const isTabShortcut =
        event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      if (isTabShortcut && !isInputShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenAi)
    },
    [executeHomeCommand, isInputShortcutTarget]
  )
  const handleOpenSettingsShortcut = useCallback(
    (event: KeyboardEvent): void => {
      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenSettings)
    },
    [executeHomeCommand]
  )
  const handleMoveSelectionDownShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isInputShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchMoveSelectionDown)
    },
    [executeHomeCommand, isInputShortcutTarget]
  )
  const handleMoveSelectionUpShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isInputShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchMoveSelectionUp)
    },
    [executeHomeCommand, isInputShortcutTarget]
  )
  const handleExecuteSelectionShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isInputShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchExecuteSelection)
    },
    [executeHomeCommand, isInputShortcutTarget]
  )

  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.searchOpenAi, handleOpenAiShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.searchOpenSettings, handleOpenSettingsShortcut)
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.searchMoveSelectionDown,
    handleMoveSelectionDownShortcut
  )
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.searchMoveSelectionUp,
    handleMoveSelectionUpShortcut
  )
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.searchExecuteSelection,
    handleExecuteSelectionShortcut
  )

  const primaryActionLabel =
    selectedItem?.presentation.primaryActionLabel ?? copy.launcher.openGeneric
  const isPrimaryActionDisabled = !selectedItem || selectedItem.availability === "planned"
  const resultsVisible = surface.chrome.footerVisible
  const showHistoryGrid = surface.body.kind === "history-grid"
  const askAiShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.searchOpenAi)
  const settingsShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.searchOpenSettings)
  const executeSelectionShortcut = useLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.searchExecuteSelection
  )
  const placeholders = useMemo(
    () => [copy.launcher.searchPlaceholder, copy.launcher.searchPlaceholderSecondary],
    [copy]
  )
  const headerLeading = previewClipboardContext ? (
    <ClipboardChip context={previewClipboardContext} onClear={onClearClipboardContext} />
  ) : undefined
  const openSettingsLabel = copy.launcher.openSettings

  return (
    <LauncherChrome
      headerLeading={headerLeading}
      inputStatus={isSearchLoading ? "pending" : "idle"}
      footer={
        resultsVisible ? (
          <>
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {isSearchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span>{isSearchLoading ? copy.launcher.searching : copy.launcher.searchResults}</span>
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
        <div className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            data-launcher-open-settings
            type="button"
            onClick={() => executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenSettings)}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-header-button flex items-center gap-2 rounded-full px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            title={openSettingsLabel}
            aria-label={openSettingsLabel}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{openSettingsLabel}</span>
            {settingsShortcut ? (
              <span className="launcher-shortcut text-[11px] text-muted-foreground">
                {settingsShortcut}
              </span>
            ) : null}
          </button>

          <div className="flex items-center gap-2 px-0 py-1">
            {askAiShortcut ? (
              <span className="launcher-shortcut text-[11px] text-muted-foreground">
                {askAiShortcut}
              </span>
            ) : null}
            <span>{copy.launcher.aiEntryLabel}</span>
          </div>
        </div>
      }
      inputRef={inputRef}
      density="compact"
      inputValue={inputValue}
      onInputKeyDown={onInputKeyDown}
      onInputValueChange={onInputValueChange}
      placeholders={placeholders}
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
