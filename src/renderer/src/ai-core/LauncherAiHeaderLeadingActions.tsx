import { ArrowLeft, ArrowRight, PanelLeftOpen, SquarePen } from "lucide-react"
import type { ReactNode } from "react"

interface LauncherAiHeaderLeadingActionsProps {
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canOpenSidebar: boolean
  canStartNewQuestion: boolean
  isSidebarOpen: boolean
  labels: {
    collapseSidebar: string
    expandSidebar: string
    goHome: string
    goToPreviousChat: string
    goToNextChat: string
    newQuestion: string
  }
  onGoToNextChat: () => void
  onGoToPreviousChat: () => void
  onGoHome: () => void
  onNewQuestion: () => void
  onSidebarPreviewChange: (isPreviewOpen: boolean) => void
  onToggleSidebar: () => void
  showBackButton: boolean
  showThreadNavigationActions: boolean
  title: string
  titleAccessory?: ReactNode
}

function LauncherAiHeaderAction(props: {
  active?: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}): React.JSX.Element {
  const {
    active = false,
    disabled = false,
    icon,
    label,
    onClick,
    onPointerEnter,
    onPointerLeave
  } = props

  return (
    <button
      type="button"
      aria-label={label}
      className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground disabled:opacity-35"
      disabled={disabled}
      title={label}
      onClick={disabled ? undefined : onClick}
      onMouseDown={(event) => event.preventDefault()}
      onPointerEnter={disabled ? undefined : onPointerEnter}
      onPointerLeave={disabled ? undefined : onPointerLeave}
      data-active={active ? "" : undefined}
    >
      {icon}
    </button>
  )
}

export function LauncherAiHeaderLeadingActions(
  props: LauncherAiHeaderLeadingActionsProps
): React.JSX.Element {
  const {
    canGoToNextChat,
    canGoToPreviousChat,
    canOpenSidebar,
    canStartNewQuestion,
    isSidebarOpen,
    labels,
    onGoToNextChat,
    onGoToPreviousChat,
    onGoHome,
    onNewQuestion,
    onSidebarPreviewChange,
    onToggleSidebar,
    showBackButton,
    showThreadNavigationActions,
    title,
    titleAccessory
  } = props
  let threadNavigationActions: ReactNode = null
  let newQuestionAction: ReactNode = null

  if (showThreadNavigationActions) {
    threadNavigationActions = (
      <div className="flex shrink-0 items-center gap-[2px]">
        <LauncherAiHeaderAction
          disabled={!canGoToPreviousChat}
          icon={<ArrowLeft className="size-[var(--ow-icon-sm)]" />}
          label={labels.goToPreviousChat}
          onClick={onGoToPreviousChat}
        />
        <LauncherAiHeaderAction
          disabled={!canGoToNextChat}
          icon={<ArrowRight className="size-[var(--ow-icon-sm)]" />}
          label={labels.goToNextChat}
          onClick={onGoToNextChat}
        />
      </div>
    )
    newQuestionAction = (
      <LauncherAiHeaderAction
        disabled={!canStartNewQuestion}
        icon={<SquarePen className="size-[var(--ow-icon-sm)]" />}
        label={labels.newQuestion}
        onClick={onNewQuestion}
      />
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-[var(--ow-gap-xs)]">
      {showBackButton ? (
        <LauncherAiHeaderAction
          icon={<ArrowLeft className="size-[var(--ow-icon-sm)]" />}
          label={labels.goHome}
          onClick={onGoHome}
        />
      ) : null}
      <LauncherAiHeaderAction
        active={isSidebarOpen}
        disabled={!canOpenSidebar}
        icon={
          isSidebarOpen ? (
            <PanelLeftOpen className="size-[var(--ow-icon-sm)] rotate-180" />
          ) : (
            <PanelLeftOpen className="size-[var(--ow-icon-sm)]" />
          )
        }
        label={isSidebarOpen ? labels.collapseSidebar : labels.expandSidebar}
        onClick={onToggleSidebar}
        onPointerEnter={() => onSidebarPreviewChange(true)}
        onPointerLeave={() => onSidebarPreviewChange(false)}
      />
      {threadNavigationActions}
      {newQuestionAction}
      <div className="ml-[var(--ow-space-1)] flex min-w-0 flex-col items-start">
        <div
          className="max-w-[28rem] truncate [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] text-foreground"
          data-launcher-ai-thread-title=""
        >
          {title}
        </div>
        {titleAccessory}
      </div>
    </div>
  )
}
