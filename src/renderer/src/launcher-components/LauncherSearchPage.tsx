import { useCallback, useMemo, useState, type RefObject } from "react"
import { ArrowRightToLine, Loader2, Settings2 } from "lucide-react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type {
  LauncherActionController,
  LauncherActionDescriptor
} from "@/features/launcher-actions/model"
import { useI18n } from "@/lib/i18n"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import type { LauncherShellConfig } from "@shared/launcher"
import type { ClipboardContext } from "@shared/clipboard"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type {
  LauncherHomeSurfaceModel,
  LauncherHomeSurfaceSection
} from "@launcher-shell/home-surface"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherIndexedCommand } from "@launcher-shell/pages"
import { ClipboardChip } from "./ClipboardChip"
import { LauncherChrome } from "./LauncherChrome"
import { LauncherHistoryGrid } from "./LauncherHistoryGrid"
import { LauncherResultList } from "./LauncherResultList"
import { LauncherUseWithManager } from "./LauncherUseWithManager"

const HOME_SHORTCUT_SCOPES = ["launcher.home"] as const
type LauncherHomeCommandId =
  | typeof LAUNCHER_COMMAND_IDS.searchOpenAi
  | typeof LAUNCHER_COMMAND_IDS.searchOpenMainHistory
  | typeof LAUNCHER_COMMAND_IDS.searchOpenSettings
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionDown
  | typeof LAUNCHER_COMMAND_IDS.searchMoveSelectionUp
  | typeof LAUNCHER_COMMAND_IDS.searchExecuteSelection

function LauncherSearchFooter(props: {
  actionController: LauncherActionController
  actionsLabel: string
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  isSearchLoading: boolean
  isSearchMode: boolean
  openSettingsLabel: string
  searchingLabel: string
  searchResultsLabel: string
  showUseWithManager: boolean
  useWithManagerTitle: string
}): React.JSX.Element {
  const {
    actionController,
    actionsLabel,
    executeHomeCommand,
    isSearchLoading,
    isSearchMode,
    openSettingsLabel,
    searchingLabel,
    searchResultsLabel,
    showUseWithManager,
    useWithManagerTitle
  } = props
  let primaryActionTitle = actionController.primaryActionFallbackTitle
  if (actionController.primaryAction) {
    primaryActionTitle = actionController.primaryAction.title
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">
        {showUseWithManager ? (
          <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] font-medium text-muted-foreground">
            <span>{useWithManagerTitle}</span>
          </div>
        ) : isSearchMode ? (
          <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] font-medium text-muted-foreground">
            {isSearchLoading ? (
              <Loader2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)] animate-spin" />
            ) : null}
            <span>{isSearchLoading ? searchingLabel : searchResultsLabel}</span>
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
            <span>{actionsLabel}</span>
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
          <span>{primaryActionTitle}</span>
          {actionController.primaryActionShortcut ? (
            <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
              {actionController.primaryActionShortcut}
            </span>
          ) : null}
        </button>
      </div>
    </>
  )
}

function LauncherSearchHeaderTrailing(props: {
  aiEntryLabel: string
  aiFooterLeading: string
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
}): React.JSX.Element {
  const { aiEntryLabel, aiFooterLeading, executeHomeCommand } = props

  return (
    <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] font-medium text-muted-foreground">
      <span>{aiFooterLeading}</span>
      <button
        type="button"
        onClick={() => executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenAi)}
        onMouseDown={(event) => event.preventDefault()}
        className="flex size-[var(--ow-hit-target-sm)] shrink-0 appearance-none items-center justify-center rounded-[var(--ow-radius-sm)] border border-border bg-background-secondary text-muted-foreground shadow-none transition hover:bg-background-interactive hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={aiEntryLabel}
        aria-label={aiEntryLabel}
      >
        <ArrowRightToLine className="size-[var(--ow-icon-compact)]" strokeWidth={1.8} />
      </button>
    </div>
  )
}

function LauncherSearchBody(props: {
  executeItem: (index: number) => void
  onRemoveHistoryItem: (itemId: string) => void
  onSectionAction: (action: NonNullable<LauncherHomeSurfaceSection["action"]>) => void
  onSetHistoryItemPinned: (itemId: string, pin: boolean) => void
  resultsViewportHeight: number
  selectedIndex: number
  showHistoryGrid: boolean
  showUseWithManager: boolean
  surface: LauncherHomeSurfaceModel
  useWithManager: {
    availableCommands: LauncherIndexedCommand[]
    enabledCommands: LauncherIndexedCommand[]
    setCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
  }
}): React.JSX.Element {
  const {
    executeItem,
    onRemoveHistoryItem,
    onSectionAction,
    onSetHistoryItemPinned,
    resultsViewportHeight,
    selectedIndex,
    showHistoryGrid,
    showUseWithManager,
    surface,
    useWithManager
  } = props

  if (showUseWithManager) {
    return (
      <LauncherUseWithManager
        availableCommands={useWithManager.availableCommands}
        enabledCommands={useWithManager.enabledCommands}
        height={resultsViewportHeight}
        onSetCommandEnabled={useWithManager.setCommandEnabled}
      />
    )
  }

  if (showHistoryGrid) {
    return (
      <LauncherHistoryGrid
        height={resultsViewportHeight}
        items={surface.items}
        onExecute={executeItem}
        onRemove={onRemoveHistoryItem}
        onSetPinned={onSetHistoryItemPinned}
        selectedIndex={selectedIndex}
      />
    )
  }

  return (
    <LauncherResultList
      height={resultsViewportHeight}
      onExecute={executeItem}
      onSectionAction={onSectionAction}
      sections={surface.sections}
      selectedIndex={selectedIndex}
    />
  )
}

function useLauncherSearchShortcuts(params: {
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  inputRef: RefObject<LauncherInputElement | null>
  inputValue: string
  setShowUseWithManager: (show: boolean) => void
  showUseWithManager: boolean
}): void {
  const {
    executeHomeCommand,
    inputRef,
    inputValue,
    setShowUseWithManager,
    showUseWithManager
  } = params
  useShortcutScopeLayer(HOME_SHORTCUT_SCOPES)
  const isInputShortcutTarget = useCallback(
    (target: EventTarget | null): boolean => target === inputRef.current,
    [inputRef]
  )
  const handleOpenAiShortcut = useCallback(
    (event: KeyboardEvent): void => {
      const isTabShortcut =
        event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      if (isTabShortcut && inputValue.trim() && !isInputShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenAi)
    },
    [executeHomeCommand, inputValue, isInputShortcutTarget]
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
      if (showUseWithManager) {
        setShowUseWithManager(false)
        return
      }

      executeHomeCommand(LAUNCHER_COMMAND_IDS.searchExecuteSelection)
    },
    [executeHomeCommand, isInputShortcutTarget, setShowUseWithManager, showUseWithManager]
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
}

export function LauncherSearchPage(props: {
  executeHomeCommand: (commandId: LauncherHomeCommandId) => void
  executeItem: (index: number) => void
  inputRef: RefObject<LauncherInputElement | null>
  inputValue: string
  isSearchLoading: boolean
  onAcceptClipboardContext: () => void
  onClearClipboardContext: () => void
  onInputKeyDown: (event: React.KeyboardEvent<LauncherInputElement>) => void
  onInputValueChange: (value: string) => void
  onRemoveHistoryItem: (itemId: string) => void
  onSetHistoryItemPinned: (itemId: string, pin: boolean) => void
  previewClipboardContext: ClipboardContext
  resultsViewportHeight: number
  selectedIndex: number
  shellConfig: LauncherShellConfig
  surface: LauncherHomeSurfaceModel
  useWithManager: {
    availableCommands: LauncherIndexedCommand[]
    enabledCommands: LauncherIndexedCommand[]
    setCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
  }
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    executeHomeCommand,
    executeItem,
    inputRef,
    inputValue,
    isSearchLoading,
    onAcceptClipboardContext,
    onClearClipboardContext,
    onInputKeyDown,
    onInputValueChange,
    onRemoveHistoryItem,
    onSetHistoryItemPinned,
    previewClipboardContext,
    resultsViewportHeight,
    selectedIndex,
    shellConfig,
    surface,
    useWithManager
  } = props
  const [showUseWithManager, setShowUseWithManager] = useState(false)
  useLauncherSearchShortcuts({
    executeHomeCommand,
    inputRef,
    inputValue,
    setShowUseWithManager,
    showUseWithManager
  })
  const selectedItem = selectedIndex >= 0 ? surface.items[selectedIndex] : null
  const footerVisible = surface.chrome.footerVisible
  const hasQuery = inputValue.trim().length > 0
  const isSearchMode = hasQuery && !showUseWithManager
  const primaryActionLabel = showUseWithManager
    ? copy.launcher.goHome
    : isSearchMode
      ? selectedItem?.kind === "ai"
        ? copy.launcher.aiPrimaryLabel
        : copy.launcher.openGeneric
      : copy.launcher.openAiHistory
  const isPrimaryActionDisabled = showUseWithManager
    ? false
    : isSearchMode
      ? !selectedItem || selectedItem.availability === "planned"
      : false
  const runPrimaryAction = useCallback((): void => {
    if (showUseWithManager) {
      setShowUseWithManager(false)
      return
    }

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
    selectedItem,
    showUseWithManager
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
    if (!isSearchMode || showUseWithManager) {
      return []
    }

    return [
      {
        id: "launcher-search-open-ai",
        onAction: () => executeHomeCommand(LAUNCHER_COMMAND_IDS.searchOpenMainHistory),
        title: copy.launcher.openAiHistory
      }
    ]
  }, [copy.launcher.openAiHistory, executeHomeCommand, isSearchMode, showUseWithManager])
  const actionController = useLauncherActionController({
    actions: searchActions,
    primaryAction,
    primaryActionFallbackTitle: primaryActionLabel
  })
  const showHistoryGrid = surface.body.kind === "history-grid"
  const placeholders = useMemo(
    () => [copy.launcher.searchPlaceholder, copy.launcher.searchPlaceholderSecondary],
    [copy]
  )
  const openSettingsLabel = copy.launcher.openSettings
  const handleInputValueChange = useCallback(
    (value: string): void => {
      if (showUseWithManager) {
        setShowUseWithManager(false)
      }

      onInputValueChange(value)
    },
    [onInputValueChange, showUseWithManager]
  )
  const handleSectionAction = useCallback(
    (action: NonNullable<LauncherHomeSurfaceSection["action"]>): void => {
      if (action.type === "manage-use-with") {
        setShowUseWithManager(true)
      }
    },
    []
  )
  const headerLeading = useMemo(() => {
    if (previewClipboardContext.kind === "none") {
      return undefined
    }

    return (
      <ClipboardChip
        context={previewClipboardContext}
        onAccept={onAcceptClipboardContext}
        onClear={onClearClipboardContext}
      />
    )
  }, [onAcceptClipboardContext, onClearClipboardContext, previewClipboardContext])
  const footer = useMemo(() => {
    if (!footerVisible) {
      return undefined
    }

    return (
      <LauncherSearchFooter
        actionController={actionController}
        actionsLabel={copy.launcher.actionsLabel}
        executeHomeCommand={executeHomeCommand}
        isSearchLoading={isSearchLoading}
        isSearchMode={isSearchMode}
        openSettingsLabel={openSettingsLabel}
        searchingLabel={copy.launcher.searching}
        searchResultsLabel={copy.launcher.searchResults}
        showUseWithManager={showUseWithManager}
        useWithManagerTitle={copy.launcher.useWithManagerTitle}
      />
    )
  }, [
    actionController,
    copy.launcher.actionsLabel,
    copy.launcher.searchResults,
    copy.launcher.searching,
    copy.launcher.useWithManagerTitle,
    executeHomeCommand,
    footerVisible,
    isSearchLoading,
    isSearchMode,
    openSettingsLabel,
    showUseWithManager
  ])
  const headerTrailing = useMemo(() => {
    if (isSearchMode) {
      return null
    }

    return (
      <LauncherSearchHeaderTrailing
        aiEntryLabel={copy.launcher.aiEntryLabel}
        aiFooterLeading={copy.launcher.aiFooterLeading}
        executeHomeCommand={executeHomeCommand}
      />
    )
  }, [
    copy.launcher.aiEntryLabel,
    copy.launcher.aiFooterLeading,
    executeHomeCommand,
    isSearchMode
  ])

  return (
    <div className="relative h-full">
      <LauncherChrome
        headerLeading={headerLeading}
        inputStatus={isSearchLoading ? "pending" : "idle"}
        footer={footer}
        headerTrailing={headerTrailing}
        inputRef={inputRef}
        inputMultiline
        inputValue={inputValue}
        onInputKeyDown={onInputKeyDown}
        onInputValueChange={handleInputValueChange}
        placeholders={placeholders}
        shellConfig={shellConfig}
        showHeaderDivider={surface.chrome.headerDividerVisible}
        surface="home"
      >
        <LauncherSearchBody
          executeItem={executeItem}
          onRemoveHistoryItem={onRemoveHistoryItem}
          onSectionAction={handleSectionAction}
          onSetHistoryItemPinned={onSetHistoryItemPinned}
          resultsViewportHeight={resultsViewportHeight}
          selectedIndex={selectedIndex}
          showHistoryGrid={showHistoryGrid}
          showUseWithManager={showUseWithManager}
          surface={surface}
          useWithManager={useWithManager}
        />
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
