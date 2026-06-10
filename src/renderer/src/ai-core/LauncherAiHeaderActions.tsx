import { ArrowLeftToLine, ArrowRightToLine, MessageCirclePlus } from "lucide-react"
import type { ReactNode } from "react"
import { LauncherAiThreadMenu } from "./LauncherAiThreadMenu"

interface LauncherAiHeaderActionsProps {
  canBranchThread: boolean
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canOpenThreadMenu: boolean
  canStartNewQuestion: boolean
  labels: {
    addAutomation: string
    actions: string
    branchIntoLocal: string
    branchIntoNewWorktree: string
    branchIntoSameWorktree: string
    branchMenu: string
    copyAsMarkdown: string
    copyChat: string
    copyDeeplink: string
    copySessionId: string
    copyWorkingDirectory: string
    goToPreviousChat: string
    goToNextChat: string
    newQuestion: string
    openSideChat: string
    pinChat: string
    renameChat: string
  }
  onBranchIntoLocal: () => void
  onCopySessionId: () => void
  onCopyWorkingDirectory: () => void
  onGoToNextChat: () => void
  onGoToPreviousChat: () => void
  onNewQuestion: () => void
}

interface LauncherAiHeaderActionProps {
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}

function LauncherAiHeaderAction(props: LauncherAiHeaderActionProps): React.JSX.Element {
  const { disabled = false, icon, label, onClick } = props

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground disabled:opacity-35"
    >
      {icon}
    </button>
  )
}

export function LauncherAiHeaderActions(props: LauncherAiHeaderActionsProps): React.JSX.Element {
  const {
    canBranchThread,
    canGoToNextChat,
    canGoToPreviousChat,
    canOpenThreadMenu,
    canStartNewQuestion,
    labels,
    onBranchIntoLocal,
    onCopySessionId,
    onCopyWorkingDirectory,
    onGoToNextChat,
    onGoToPreviousChat,
    onNewQuestion
  } = props

  return (
    <div className="flex shrink-0 items-center gap-[var(--ow-gap-xs)]">
      <LauncherAiHeaderAction
        disabled={!canGoToPreviousChat}
        icon={<ArrowLeftToLine className="size-[var(--ow-icon-sm)]" />}
        label={labels.goToPreviousChat}
        onClick={onGoToPreviousChat}
      />
      <LauncherAiHeaderAction
        disabled={!canGoToNextChat}
        icon={<ArrowRightToLine className="size-[var(--ow-icon-sm)]" />}
        label={labels.goToNextChat}
        onClick={onGoToNextChat}
      />
      <LauncherAiHeaderAction
        disabled={!canStartNewQuestion}
        icon={<MessageCirclePlus className="size-[var(--ow-icon-sm)]" />}
        label={labels.newQuestion}
        onClick={onNewQuestion}
      />
      {canOpenThreadMenu ? (
        <LauncherAiThreadMenu
          canBranchThread={canBranchThread}
          labels={{
            addAutomation: labels.addAutomation,
            branchIntoLocal: labels.branchIntoLocal,
            branchIntoNewWorktree: labels.branchIntoNewWorktree,
            branchIntoSameWorktree: labels.branchIntoSameWorktree,
            branchMenu: labels.branchMenu,
            copyAsMarkdown: labels.copyAsMarkdown,
            copyChat: labels.copyChat,
            copyDeeplink: labels.copyDeeplink,
            copySessionId: labels.copySessionId,
            copyWorkingDirectory: labels.copyWorkingDirectory,
            moreActions: labels.actions,
            openSideChat: labels.openSideChat,
            pinChat: labels.pinChat,
            renameChat: labels.renameChat
          }}
          onBranchIntoLocal={onBranchIntoLocal}
          onCopySessionId={onCopySessionId}
          onCopyWorkingDirectory={onCopyWorkingDirectory}
        />
      ) : null}
    </div>
  )
}
