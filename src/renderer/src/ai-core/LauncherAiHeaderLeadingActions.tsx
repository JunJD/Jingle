import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react"
import type { ReactNode } from "react"
import { IconButton } from "@/components/ui/icon-button"

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
    <IconButton
      className="launcher-icon-button flex size-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-[var(--jingle-radius-sm)] border-0 p-0 text-muted-foreground transition hover:text-foreground disabled:opacity-35"
      disabled={disabled}
      label={label}
      onClick={disabled ? undefined : onClick}
      onMouseDown={(event) => event.preventDefault()}
      onPointerEnter={disabled ? undefined : onPointerEnter}
      onPointerLeave={disabled ? undefined : onPointerLeave}
      pressed={active}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {icon}
    </IconButton>
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
          icon={<ArrowLeft className="size-[var(--jingle-icon-sm)]" />}
          label={labels.goToPreviousChat}
          onClick={onGoToPreviousChat}
        />
        <LauncherAiHeaderAction
          disabled={!canGoToNextChat}
          icon={<ArrowRight className="size-[var(--jingle-icon-sm)]" />}
          label={labels.goToNextChat}
          onClick={onGoToNextChat}
        />
      </div>
    )
    newQuestionAction = (
      <LauncherAiHeaderAction
        disabled={!canStartNewQuestion}
        icon={<SquarePen className="size-[var(--jingle-icon-sm)]" />}
        label={labels.newQuestion}
        onClick={onNewQuestion}
      />
    )
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-[var(--jingle-gap-xs)]">
      {showBackButton ? (
        <LauncherAiHeaderAction
          icon={<ArrowLeft className="size-[var(--jingle-icon-sm)]" />}
          label={labels.goHome}
          onClick={onGoHome}
        />
      ) : null}
      <LauncherAiHeaderAction
        active={isSidebarOpen}
        disabled={!canOpenSidebar}
        icon={
          isSidebarOpen ? (
            <PanelLeftClose className="size-[var(--jingle-icon-sm)]" strokeWidth={1.8} />
          ) : (
            <PanelLeftOpen className="size-[var(--jingle-icon-sm)]" strokeWidth={1.8} />
          )
        }
        label={isSidebarOpen ? labels.collapseSidebar : labels.expandSidebar}
        onClick={onToggleSidebar}
        onPointerEnter={() => onSidebarPreviewChange(true)}
        onPointerLeave={() => onSidebarPreviewChange(false)}
      />
      {threadNavigationActions}
      {newQuestionAction}
      <div className="ml-[var(--jingle-space-1)] flex min-w-0 max-w-[36rem] flex-1 flex-col items-start justify-center gap-[2px] self-stretch py-[var(--jingle-space-1)]">
        <div
          className="w-full truncate [font-size:var(--jingle-font-control)] font-semibold leading-[18px] text-foreground"
          data-launcher-ai-thread-title=""
        >
          {title}
        </div>
        {titleAccessory}
      </div>
    </div>
  )
}
