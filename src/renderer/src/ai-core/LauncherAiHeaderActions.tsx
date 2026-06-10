import {
  AppWindow,
  ArrowLeftToLine,
  ArrowRightToLine,
  Command,
  GitBranchPlus,
  MessageCirclePlus
} from "lucide-react"
import type { ReactNode } from "react"

interface LauncherAiHeaderActionsProps {
  canBranchThread: boolean
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canOpenActions: boolean
  canStartNewQuestion: boolean
  labels: {
    actions: string
    branchThread: string
    goToNextChat: string
    goToPreviousChat: string
    newQuestion: string
    openMainChat: string
  }
  onBranchThread: () => void
  onGoToNextChat: () => void
  onGoToPreviousChat: () => void
  onNewQuestion: () => void
  onOpenActions: () => void
  onOpenMainChat: () => void
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
    canOpenActions,
    canStartNewQuestion,
    labels,
    onBranchThread,
    onGoToNextChat,
    onGoToPreviousChat,
    onNewQuestion,
    onOpenActions,
    onOpenMainChat
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
      <LauncherAiHeaderAction
        disabled={!canBranchThread}
        icon={<GitBranchPlus className="size-[var(--ow-icon-sm)]" />}
        label={labels.branchThread}
        onClick={onBranchThread}
      />
      <LauncherAiHeaderAction
        icon={<AppWindow className="size-[var(--ow-icon-sm)]" />}
        label={labels.openMainChat}
        onClick={onOpenMainChat}
      />
      {canOpenActions ? (
        <LauncherAiHeaderAction
          icon={<Command className="size-[var(--ow-icon-sm)]" />}
          label={labels.actions}
          onClick={onOpenActions}
        />
      ) : null}
    </div>
  )
}
