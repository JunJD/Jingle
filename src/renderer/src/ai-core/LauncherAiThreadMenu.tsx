import * as DropdownMenu from "@/components/ui/dropdown-menu"
import {
  BookOpenText,
  Clock,
  Copy,
  FileText,
  Folder,
  GitBranch,
  Link,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  PictureInPicture2,
  Pin
} from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface LauncherAiThreadMenuProps {
  canBranchThread: boolean
  canOpenMainWindow: boolean
  labels: {
    addAutomation: string
    branchIntoLocal: string
    branchIntoNewWorktree: string
    branchIntoSameWorktree: string
    branchMenu: string
    copyAsMarkdown: string
    copyChat: string
    copyDeeplink: string
    copySessionId: string
    copyWorkingDirectory: string
    moreActions: string
    openMainWindow: string
    openSideChat: string
    pinChat: string
    renameChat: string
    underDevelopment: string
    unpinChat: string
  }
  isPinned: boolean
  onBranchIntoLocal: () => void
  onCopySessionId: () => void
  onCopyWorkingDirectory: () => void
  onOpenMainWindow: () => void
  onTogglePinned: () => void
  showOpenMainWindowAction: boolean
}

interface ThreadMenuItemProps {
  children: ReactNode
  disabled?: boolean
  icon: ReactNode
  onSelect?: (event: Event) => void
  trailingLabel?: string
}

function preventDefaultSelect(event: Event): void {
  event.preventDefault()
}

function ThreadMenuItem(props: ThreadMenuItemProps): React.JSX.Element {
  const { children, disabled = false, icon, onSelect, trailingLabel } = props
  let itemOnSelect = preventDefaultSelect
  let trailingLabelElement: ReactNode = null

  if (onSelect !== undefined) {
    itemOnSelect = onSelect
  }

  if (trailingLabel) {
    trailingLabelElement = (
      <span className="launcher-thread-menu__trailing-label">{trailingLabel}</span>
    )
  }

  return (
    <DropdownMenu.Item
      className="launcher-thread-menu__item"
      disabled={disabled}
      onSelect={itemOnSelect}
    >
      <span className="launcher-thread-menu__icon">{icon}</span>
      <span className="launcher-thread-menu__label">{children}</span>
      {trailingLabelElement}
    </DropdownMenu.Item>
  )
}

function ThreadMenuSubmenu(props: {
  children: ReactNode
  icon: ReactNode
  label: string
}): React.JSX.Element {
  const { children, icon, label } = props

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="launcher-thread-menu__item">
        <span className="launcher-thread-menu__icon">{icon}</span>
        <span className="launcher-thread-menu__label">{label}</span>
        <span className="launcher-thread-menu__chevron">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          className="launcher-thread-menu launcher-thread-menu__subcontent"
          sideOffset={8}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

export function LauncherAiThreadMenu(props: LauncherAiThreadMenuProps): React.JSX.Element {
  const {
    canBranchThread,
    canOpenMainWindow,
    isPinned,
    labels,
    onBranchIntoLocal,
    onCopySessionId,
    onCopyWorkingDirectory,
    onOpenMainWindow,
    onTogglePinned,
    showOpenMainWindowAction
  } = props
  let pinnedWindowItem: ReactNode = null
  let pinLabel = labels.pinChat

  if (isPinned) {
    pinLabel = labels.unpinChat
  }

  if (showOpenMainWindowAction) {
    pinnedWindowItem = (
      <ThreadMenuItem
        disabled={!canOpenMainWindow}
        icon={<PictureInPicture2 />}
        onSelect={onOpenMainWindow}
      >
        {labels.openMainWindow}
      </ThreadMenuItem>
    )
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.moreActions}
          title={labels.moreActions}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            "launcher-icon-button launcher-thread-menu__trigger flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground",
            "aria-[expanded=true]:bg-background-secondary/70 aria-[expanded=true]:text-foreground"
          )}
        >
          <MoreHorizontal className="size-[var(--jingle-icon-sm)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="launcher-thread-menu"
          side="bottom"
          sideOffset={6}
        >
          <ThreadMenuItem icon={<Pin />} onSelect={onTogglePinned}>
            {pinLabel}
          </ThreadMenuItem>
          {pinnedWindowItem}
          <ThreadMenuItem
            icon={<Pencil />}
            onSelect={preventDefaultSelect}
            trailingLabel={labels.underDevelopment}
          >
            {labels.renameChat}
          </ThreadMenuItem>
          <ThreadMenuItem
            icon={<MessageSquarePlus />}
            onSelect={preventDefaultSelect}
            trailingLabel={labels.underDevelopment}
          >
            {labels.openSideChat}
          </ThreadMenuItem>

          <ThreadMenuSubmenu icon={<Copy />} label={labels.copyChat}>
            <ThreadMenuItem icon={<Folder />} onSelect={onCopyWorkingDirectory}>
              {labels.copyWorkingDirectory}
            </ThreadMenuItem>
            <ThreadMenuItem icon={<FileText />} onSelect={onCopySessionId}>
              {labels.copySessionId}
            </ThreadMenuItem>
            <ThreadMenuItem
              icon={<Link />}
              onSelect={preventDefaultSelect}
              trailingLabel={labels.underDevelopment}
            >
              {labels.copyDeeplink}
            </ThreadMenuItem>
            <ThreadMenuItem
              icon={<BookOpenText />}
              onSelect={preventDefaultSelect}
              trailingLabel={labels.underDevelopment}
            >
              {labels.copyAsMarkdown}
            </ThreadMenuItem>
          </ThreadMenuSubmenu>

          <ThreadMenuSubmenu icon={<GitBranch />} label={labels.branchMenu}>
            <ThreadMenuItem
              disabled={!canBranchThread}
              icon={<GitBranch />}
              onSelect={onBranchIntoLocal}
            >
              {labels.branchIntoLocal}
            </ThreadMenuItem>
            <ThreadMenuItem
              icon={<GitBranch />}
              onSelect={preventDefaultSelect}
              trailingLabel={labels.underDevelopment}
            >
              {labels.branchIntoSameWorktree}
            </ThreadMenuItem>
            <ThreadMenuItem
              icon={<GitBranch />}
              onSelect={preventDefaultSelect}
              trailingLabel={labels.underDevelopment}
            >
              {labels.branchIntoNewWorktree}
            </ThreadMenuItem>
          </ThreadMenuSubmenu>

          <ThreadMenuItem
            icon={<Clock />}
            onSelect={preventDefaultSelect}
            trailingLabel={labels.underDevelopment}
          >
            {labels.addAutomation}
          </ThreadMenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
