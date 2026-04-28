import { useCallback, useMemo, type RefObject } from "react"
import { Loader2, Settings2 } from "lucide-react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
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
  | typeof LAUNCHER_COMMAND_IDS.searchOpenMainHistory
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

  const footerVisible = surface.chrome.footerVisible
  const isSearchMode = inputValue.trim().length > 0
  const primaryActionLabel = isSearchMode
    ? selectedItem?.kind === "ai"
      ? copy.launcher.aiPrimaryLabel
      : copy.launcher.openGeneric
    : copy.launcher.openAiHistory
  const isPrimaryActionDisabled = isSearchMode
    ? !selectedItem || selectedItem.availability === "planned"
    : false
  const runPrimaryAction = useCallback((): void => {
    if (!isSearchMode) {
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenMainHistory)
      return
    }

    if (!selectedItem || isPrimaryActionDisabled) {
      return
    }

    executeItem(selectedIndex)
  }, [
    executeHomeCommand,
    executeItem,
    isPrimaryActionDisabled,
    isSearchMode,
    selectedIndex,
    selectedItem
  ])
  const primaryAction = useMemo<LauncherActionDescriptor | null>(() => {
    if (isPrimaryActionDisabled) {
      return null
    }

    return {
      id: "launcher-search-primary",
      onAction: runPrimaryAction,
      title: primaryActionLabel
    }
  }, [isPrimaryActionDisabled, primaryActionLabel, runPrimaryAction])
  const searchActions = useMemo<LauncherActionDescriptor[]>(() => {
    if (!isSearchMode) {
      return []
    }

    return [
      {
        id: "launcher-search-open-ai",
        onAction: () => executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenMainHistory),
        title: copy.launcher.openAiHistory
      }
    ]
  }, [copy.launcher.openAiHistory, executeHomeCommand, isSearchMode])
  const actionController = useLauncherActionController({
    actions: searchActions,
    primaryAction,
    primaryActionFallbackTitle: primaryActionLabel
  })
  const showHistoryGrid = surface.body.kind === "history-grid"
  const openAiShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.searchOpenAi)
  const placeholders = useMemo(
    () => [copy.launcher.searchPlaceholder, copy.launcher.searchPlaceholderSecondary],
    [copy]
  )
  const headerLeading = previewClipboardContext ? (
    <ClipboardChip context={previewClipboardContext} onClear={onClearClipboardContext} />
  ) : undefined
  const openSettingsLabel = copy.launcher.openSettings

  return (
    <div className="relative h-full">
      <LauncherChrome
        headerLeading={headerLeading}
        inputStatus={isSearchLoading ? "pending" : "idle"}
        footer={
          footerVisible ? (
            <>
              <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">
                {isSearchMode ? (
                  <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] font-medium text-muted-foreground">
                    {isSearchLoading ? (
                      <Loader2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)] animate-spin" />
                    ) : null}
                    <span>
                      {isSearchLoading ? copy.launcher.searching : copy.launcher.searchResults}
                    </span>
                  </div>
                ) : (
                  <button
                    data-launcher-open-settings
                    type="button"
                    onClick={() => executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenSettings)}
                    onMouseDown={(event) => event.preventDefault()}
                    className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
                    title={openSettingsLabel}
                    aria-label={openSettingsLabel}
                  >
                    <Settings2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
                    <span>{openSettingsLabel}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-[var(--ow-gap-sm)]">
                {actionController.canOpenActions ? (
                  <button
                    type="button"
                    onClick={actionController.openActions}
                    onMouseDown={(event) => event.preventDefault()}
                    className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
                  >
                    <span>{copy.launcher.actionsLabel}</span>
                    {actionController.actionPanelShortcut ? (
                      <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                        {actionController.actionPanelShortcut}
                      </span>
                    ) : null}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={actionController.executePrimaryAction}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={!actionController.primaryAction}
                  className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground disabled:cursor-default disabled:opacity-50"
                >
                  <span>
                    {actionController.primaryAction?.title ??
                      actionController.primaryActionFallbackTitle}
                  </span>
                  {actionController.primaryActionShortcut ? (
                    <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                      {actionController.primaryActionShortcut}
                    </span>
                  ) : null}
                </button>
              </div>
            </>
          ) : undefined
        }
        headerTrailing={
          <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] font-medium text-muted-foreground">
            <div className="flex items-center gap-[var(--ow-gap-sm)] px-0 py-[var(--ow-space-1)]">
              <span>{copy.launcher.aiEntryLabel}</span>
              {openAiShortcut ? (
                <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                  {openAiShortcut}
                </span>
              ) : null}
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
            height={resultsViewportHeight}
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

      {actionController.showActions && actionController.canOpenActions ? (
        <LauncherActionOverlay
          actions={actionController.actions}
          onClose={actionController.closeActions}
          surfaceId="launcher-search-action-panel"
        />
      ) : null}
    </div>
  )
}
