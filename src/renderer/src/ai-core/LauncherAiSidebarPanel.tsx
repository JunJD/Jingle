import {
  ChevronRight,
  Clock,
  Archive,
  GitBranchPlus,
  Folder,
  FolderPlus,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Search,
  SquarePen,
  X
} from "lucide-react"
import {
  forwardRef,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode
} from "react"
import type {
  ThreadSidebarOrganizeMode,
  ThreadSidebarProjectGroup,
  ThreadSidebarSortBy,
  ThreadSidebarThreadItem,
  ThreadSidebarView
} from "@shared/thread-sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { formatRelativeTime } from "@/lib/utils"
import type { AppLocale } from "@shared/i18n"

type SidebarSectionKey = "chats" | "pinned" | "projects"
type SidebarThreadMenuActionResult = Promise<void> | void

export interface LauncherAiSidebarThreadItem {
  id: string
  isActive: boolean
  isPinned: boolean
  workspacePath: string | null
  title: string
  updatedAt: Date
}

export interface LauncherAiSidebarProjectGroup {
  key: string
  title: string
  workspacePath: string
  threads: LauncherAiSidebarThreadItem[]
}

interface LauncherAiSidebarThreadMenuLabels {
  archiveChat: string
  branchIntoLocal: string
  branchIntoNewWorktree: string
  copyDeeplink: string
  copySessionId: string
  copyWorkingDirectory: string
  markAsUnread: string
  openThreadInNewWindow: string
  pinChat: string
  renameChat: string
  revealInFinder: string
  unpinChat: string
}

interface LauncherAiSidebarThreadMenuActions {
  onArchive: (threadId: string) => SidebarThreadMenuActionResult
  onBranchIntoLocal: (threadId: string) => SidebarThreadMenuActionResult
  onCopySessionId: (threadId: string) => SidebarThreadMenuActionResult
  onCopyWorkingDirectory: (workspacePath: string) => SidebarThreadMenuActionResult
  onOpenInNewWindow: (threadId: string) => SidebarThreadMenuActionResult
  onRevealInFinder: (workspacePath: string) => SidebarThreadMenuActionResult
  onTogglePinned: (threadId: string, pinned: boolean) => SidebarThreadMenuActionResult
}

interface LauncherAiSidebarProjectMenuLabels {
  archiveChats: string
  copyWorkingDirectory: string
  createPermanentWorktree: string
  newChat: string
  pinProject: string
  projectOptions: string
  removeProject: string
  renameProject: string
  revealInFinder: string
}

interface LauncherAiSidebarProjectActions {
  onCopyWorkingDirectory: (workspacePath: string) => SidebarThreadMenuActionResult
  onCreateChat: (workspacePath: string) => SidebarThreadMenuActionResult
  onRevealInFinder: (workspacePath: string) => SidebarThreadMenuActionResult
}

interface LauncherAiSidebarPanelProps {
  labels: {
    addProject: string
    archiveChat: string
    branchIntoLocal: string
    branchIntoNewWorktree: string
    copyDeeplink: string
    copySessionId: string
    copyWorkingDirectory: string
    expandSidebar: string
    markAsUnread: string
    organizeByProject: string
    organizeByTime: string
    openThreadInNewWindow: string
    pinChat: string
    pinProject: string
    createPermanentWorktree: string
    projectOptions: string
    renameChat: string
    renameProject: string
    removeProject: string
    revealInFinder: string
    sidebarAutomation: string
    sidebarChats: string
    sidebarArchiveAllChats: string
    sidebarEmptyPinned: string
    sidebarEmptyProjects: string
    sidebarEmptyRecent: string
    sidebarNewChat: string
    sidebarPinned: string
    sidebarProjects: string
    sidebarSearch: string
    sortByCreated: string
    sortByManual: string
    sortByUpdated: string
    unpinChat: string
  }
  locale: AppLocale
  mode: "expanded" | "preview"
  projectActions: LauncherAiSidebarProjectActions
  threadMenuActions: LauncherAiSidebarThreadMenuActions
  onAddProject: () => SidebarThreadMenuActionResult
  onNewChat: () => void
  onOpenSearch: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onSelectThread: (threadId: string) => void
  onSetSidebarOrganizeMode: (mode: ThreadSidebarOrganizeMode) => SidebarThreadMenuActionResult
  onSetSidebarSortBy: (sortBy: ThreadSidebarSortBy) => SidebarThreadMenuActionResult
  sidebarView: ThreadSidebarView | null
  activeThreadId: string | null
}

function SidebarAction(props: {
  disabled?: boolean
  icon: ReactNode
  label: string
  onAction?: () => void
}): React.JSX.Element {
  const { disabled = false, icon, label, onAction } = props

  return (
    <button
      type="button"
      className="launcher-ai-sidebar-panel__action"
      disabled={disabled}
      title={label}
      onClick={disabled ? undefined : onAction}
    >
      <span className="launcher-ai-sidebar-panel__action-icon">{icon}</span>
      <span className="launcher-ai-sidebar-panel__action-label">{label}</span>
    </button>
  )
}

function SectionHeading(props: {
  children: ReactNode
  isOpen: boolean
  actions?: ReactNode
  onToggle: () => void
}): React.JSX.Element {
  const { actions, children, isOpen, onToggle } = props

  return (
    <SidebarRow
      actions={actions}
      expanded={isOpen}
      label={children}
      variant="section"
      onPress={onToggle}
    />
  )
}

function EmptySectionRow(props: { children: ReactNode }): React.JSX.Element {
  return <div className="launcher-ai-sidebar-panel__empty">{props.children}</div>
}

interface SidebarRowProps extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  actions?: ReactNode
  active?: boolean
  depth?: "child" | "root"
  expanded?: boolean
  icon?: ReactNode
  label: ReactNode
  meta?: ReactNode
  onPress: () => void
  title?: string
  variant?: "item" | "section"
}

const SidebarRow = forwardRef<HTMLDivElement, SidebarRowProps>(
  function SidebarRow(props, ref): React.JSX.Element {
    const {
      actions,
      active = false,
      className,
      depth = "root",
      expanded,
      icon,
      label,
      meta,
      onPress,
      title,
      variant = "item",
      ...rootProps
    } = props
    const rowClassName = ["launcher-ai-sidebar-panel__item-row", className]
      .filter(Boolean)
      .join(" ")
    const resolvedTitle = title ?? (typeof label === "string" ? label : undefined)

    return (
      <div
        {...rootProps}
        ref={ref}
        className={rowClassName}
        data-active={active ? "" : undefined}
        data-depth={depth}
        data-has-actions={actions ? "" : undefined}
        data-has-icon={icon ? "" : undefined}
        data-variant={variant}
      >
        <button
          type="button"
          aria-expanded={expanded}
          className="launcher-ai-sidebar-panel__item"
          title={resolvedTitle}
          onClick={onPress}
        >
          {icon == null ? null : (
            <span className="launcher-ai-sidebar-panel__item-icon">{icon}</span>
          )}
          <span className="launcher-ai-sidebar-panel__item-title">{label}</span>
          {expanded == null ? null : (
            <ChevronRight
              aria-hidden="true"
              className="launcher-ai-sidebar-panel__item-chevron"
              data-open={expanded ? "" : undefined}
            />
          )}
          {meta == null ? null : (
            <span className="launcher-ai-sidebar-panel__item-meta">{meta}</span>
          )}
        </button>
        {actions == null ? null : (
          <div className="launcher-ai-sidebar-panel__item-actions">{actions}</div>
        )}
      </div>
    )
  }
)

function ProjectSectionActions(props: {
  labels: {
    addProject: string
    archiveAllChats: string
    organizeByProject: string
    organizeByTime: string
    projectOptions: string
    sortByCreated: string
    sortByManual: string
    sortByUpdated: string
  }
  onAddProject: () => SidebarThreadMenuActionResult
  onSetOrganizeMode: (mode: ThreadSidebarOrganizeMode) => SidebarThreadMenuActionResult
  onSetSortBy: (sortBy: ThreadSidebarSortBy) => SidebarThreadMenuActionResult
  organizeMode: ThreadSidebarOrganizeMode
  sortBy: ThreadSidebarSortBy
}): React.JSX.Element {
  const { labels, onAddProject, onSetOrganizeMode, onSetSortBy, organizeMode, sortBy } = props

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={labels.projectOptions}
            className="launcher-ai-sidebar-panel__item-action"
            title={labels.projectOptions}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" className="launcher-thread-menu" sideOffset={6}>
            <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
              {labels.archiveAllChats}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              className="launcher-thread-menu__item"
              onSelect={() => {
                void onSetOrganizeMode("project")
              }}
            >
              {labels.organizeByProject}
              {organizeMode === "project" ? " ✓" : ""}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="launcher-thread-menu__item"
              onSelect={() => {
                void onSetOrganizeMode("chronological")
              }}
            >
              {labels.organizeByTime}
              {organizeMode === "chronological" ? " ✓" : ""}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              className="launcher-thread-menu__item"
              onSelect={() => {
                void onSetSortBy("updated")
              }}
            >
              {labels.sortByUpdated}
              {sortBy === "updated" ? " ✓" : ""}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="launcher-thread-menu__item"
              onSelect={() => {
                void onSetSortBy("created")
              }}
            >
              {labels.sortByCreated}
              {sortBy === "created" ? " ✓" : ""}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="launcher-thread-menu__item"
              onSelect={() => {
                void onSetSortBy("manual")
              }}
            >
              {labels.sortByManual}
              {sortBy === "manual" ? " ✓" : ""}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button
        type="button"
        aria-label={labels.addProject}
        className="launcher-ai-sidebar-panel__item-action"
        title={labels.addProject}
        onClick={() => {
          void onAddProject()
        }}
      >
        <FolderPlus aria-hidden="true" />
      </button>
    </>
  )
}

function SidebarThreadContextMenu(props: {
  actions: LauncherAiSidebarThreadMenuActions
  labels: LauncherAiSidebarThreadMenuLabels
  thread: LauncherAiSidebarThreadItem
}): React.JSX.Element {
  const { actions, labels, thread } = props
  const workspacePath = thread.workspacePath

  return (
    <ContextMenuContent className="launcher-thread-menu">
      <ContextMenuItem
        className="launcher-thread-menu__item"
        onSelect={() => {
          void actions.onTogglePinned(thread.id, !thread.isPinned)
        }}
      >
        {thread.isPinned ? labels.unpinChat : labels.pinChat}
      </ContextMenuItem>
      <ContextMenuItem className="launcher-thread-menu__item" disabled>
        {labels.renameChat}
      </ContextMenuItem>
      <ContextMenuItem
        className="launcher-thread-menu__item"
        onSelect={() => {
          void actions.onArchive(thread.id)
        }}
      >
        {labels.archiveChat}
      </ContextMenuItem>
      <ContextMenuItem className="launcher-thread-menu__item" disabled>
        {labels.markAsUnread}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="launcher-thread-menu__item"
        disabled={!workspacePath}
        onSelect={
          workspacePath
            ? () => {
                void actions.onRevealInFinder(workspacePath)
              }
            : undefined
        }
      >
        {labels.revealInFinder}
      </ContextMenuItem>
      <ContextMenuItem
        className="launcher-thread-menu__item"
        disabled={!workspacePath}
        onSelect={
          workspacePath
            ? () => {
                void actions.onCopyWorkingDirectory(workspacePath)
              }
            : undefined
        }
      >
        {labels.copyWorkingDirectory}
      </ContextMenuItem>
      <ContextMenuItem
        className="launcher-thread-menu__item"
        onSelect={() => {
          void actions.onCopySessionId(thread.id)
        }}
      >
        {labels.copySessionId}
      </ContextMenuItem>
      <ContextMenuItem className="launcher-thread-menu__item" disabled>
        {labels.copyDeeplink}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="launcher-thread-menu__item"
        onSelect={() => {
          void actions.onBranchIntoLocal(thread.id)
        }}
      >
        {labels.branchIntoLocal}
      </ContextMenuItem>
      <ContextMenuItem className="launcher-thread-menu__item" disabled>
        {labels.branchIntoNewWorktree}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="launcher-thread-menu__item"
        onSelect={() => {
          void actions.onOpenInNewWindow(thread.id)
        }}
      >
        {labels.openThreadInNewWindow}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

function ThreadRow(props: {
  depth?: "child" | "root"
  icon: ReactNode
  locale: AppLocale
  menuActions: LauncherAiSidebarThreadMenuActions
  menuLabels: LauncherAiSidebarThreadMenuLabels
  onMenuOpenChange: (isOpen: boolean) => void
  onSelect: () => void
  thread: LauncherAiSidebarThreadItem
}): React.JSX.Element {
  const {
    depth = "root",
    icon,
    locale,
    menuActions,
    menuLabels,
    onMenuOpenChange,
    onSelect,
    thread
  } = props

  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <SidebarRow
          active={thread.isActive}
          depth={depth}
          icon={icon}
          label={thread.title}
          meta={formatRelativeTime(thread.updatedAt, locale)}
          title={thread.title}
          onPress={onSelect}
        />
      </ContextMenuTrigger>
      <SidebarThreadContextMenu actions={menuActions} labels={menuLabels} thread={thread} />
    </ContextMenu>
  )
}

function ProjectFolderMenu(props: {
  actions: LauncherAiSidebarProjectActions
  group: LauncherAiSidebarProjectGroup
  labels: LauncherAiSidebarProjectMenuLabels
}): React.JSX.Element {
  const { actions, group, labels } = props
  const workspacePath = group.workspacePath

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.projectOptions}
          className="launcher-ai-sidebar-panel__item-action"
          title={labels.projectOptions}
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="launcher-thread-menu" sideOffset={6}>
          <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
            <Pin aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.pinProject}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="launcher-thread-menu__item"
            onSelect={() => {
              void actions.onRevealInFinder(workspacePath)
            }}
          >
            <FolderOpen aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.revealInFinder}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
            <GitBranchPlus aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.createPermanentWorktree}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
            <SquarePen aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.renameProject}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
            <Archive aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.archiveChats}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="launcher-thread-menu__item" disabled>
            <X aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.removeProject}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            className="launcher-thread-menu__item"
            onSelect={() => {
              void actions.onCopyWorkingDirectory(workspacePath)
            }}
          >
            <Folder aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.copyWorkingDirectory}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="launcher-thread-menu__item"
            onSelect={() => {
              void actions.onCreateChat(workspacePath)
            }}
          >
            <SquarePen aria-hidden="true" className="launcher-thread-menu__icon" />
            <span>{labels.newChat}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ProjectFolderRow(props: {
  actions: LauncherAiSidebarProjectActions
  group: LauncherAiSidebarProjectGroup
  isOpen: boolean
  labels: LauncherAiSidebarProjectMenuLabels
  onToggle: () => void
}): React.JSX.Element {
  const { actions, group, isOpen, labels, onToggle } = props
  const Icon = isOpen ? FolderOpen : Folder

  return (
    <SidebarRow
      actions={
        <>
          <button
            type="button"
            aria-label={labels.newChat}
            className="launcher-ai-sidebar-panel__item-action"
            title={labels.newChat}
            onClick={(event) => {
              event.stopPropagation()
              void actions.onCreateChat(group.workspacePath)
            }}
          >
            <SquarePen aria-hidden="true" />
          </button>
          <ProjectFolderMenu actions={actions} group={group} labels={labels} />
        </>
      }
      expanded={isOpen}
      icon={<Icon aria-hidden="true" />}
      label={group.title}
      title={group.key}
      onPress={onToggle}
    />
  )
}

export function LauncherAiSidebarPanel(props: LauncherAiSidebarPanelProps): React.JSX.Element {
  const {
    activeThreadId,
    labels,
    locale,
    mode,
    onNewChat,
    onOpenSearch,
    onAddProject,
    onPointerEnter,
    onPointerLeave,
    onSelectThread,
    onSetSidebarOrganizeMode,
    onSetSidebarSortBy,
    projectActions,
    sidebarView,
    threadMenuActions,
  } = props
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<SidebarSectionKey>>(
    () => new Set()
  )
  const [projectExpansionOverrides, setProjectExpansionOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map())
  const [isThreadContextMenuOpen, setIsThreadContextMenuOpen] = useState(false)
  const isPointerInsidePanelRef = useRef(false)
  const chatThreads = (sidebarView?.chatThreads ?? []).map((thread) =>
    mapSidebarThreadItem(thread, activeThreadId)
  )
  const pinnedThreads = (sidebarView?.pinnedThreads ?? []).map((thread) =>
    mapSidebarThreadItem(thread, activeThreadId)
  )
  const projectGroups = (sidebarView?.projectGroups ?? []).map((group) =>
    mapSidebarProjectGroup(group, activeThreadId)
  )
  const activeProjectKey =
    projectGroups.find((group) => group.threads.some((thread) => thread.isActive))?.key ??
    projectGroups[0]?.key ??
    null
  const toggleSection = (section: SidebarSectionKey): void => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }
  const toggleProject = (group: LauncherAiSidebarProjectGroup): void => {
    const defaultOpen = group.key === activeProjectKey
    const currentOpen = projectExpansionOverrides.get(group.key) ?? defaultOpen

    setProjectExpansionOverrides((current) => {
      const next = new Map(current)
      next.set(group.key, !currentOpen)
      return next
    })
  }
  const isPinnedOpen = !collapsedSections.has("pinned")
  const isProjectsOpen = !collapsedSections.has("projects")
  const isChatsOpen = !collapsedSections.has("chats")
  const handlePanelPointerEnter = (): void => {
    isPointerInsidePanelRef.current = true
    onPointerEnter?.()
  }
  const handlePanelPointerLeave = (): void => {
    isPointerInsidePanelRef.current = false
    if (isThreadContextMenuOpen) {
      return
    }

    onPointerLeave?.()
  }
  const handleThreadMenuOpenChange = (isOpen: boolean): void => {
    setIsThreadContextMenuOpen(isOpen)
    if (isOpen) {
      onPointerEnter?.()
      return
    }

    if (!isPointerInsidePanelRef.current) {
      onPointerLeave?.()
    }
  }
  const threadMenuLabels = {
    archiveChat: labels.archiveChat,
    branchIntoLocal: labels.branchIntoLocal,
    branchIntoNewWorktree: labels.branchIntoNewWorktree,
    copyDeeplink: labels.copyDeeplink,
    copySessionId: labels.copySessionId,
    copyWorkingDirectory: labels.copyWorkingDirectory,
    markAsUnread: labels.markAsUnread,
    openThreadInNewWindow: labels.openThreadInNewWindow,
    pinChat: labels.pinChat,
    renameChat: labels.renameChat,
    revealInFinder: labels.revealInFinder,
    unpinChat: labels.unpinChat
  }
  const projectSectionLabels = {
    addProject: labels.addProject,
    archiveAllChats: labels.sidebarArchiveAllChats,
    organizeByProject: labels.organizeByProject,
    organizeByTime: labels.organizeByTime,
    projectOptions: labels.projectOptions,
    sortByCreated: labels.sortByCreated,
    sortByManual: labels.sortByManual,
    sortByUpdated: labels.sortByUpdated
  }
  const projectMenuLabels = {
    archiveChats: labels.archiveChat,
    copyWorkingDirectory: labels.copyWorkingDirectory,
    createPermanentWorktree: labels.createPermanentWorktree,
    newChat: labels.sidebarNewChat,
    pinProject: labels.pinProject,
    projectOptions: labels.projectOptions,
    removeProject: labels.removeProject,
    renameProject: labels.renameProject,
    revealInFinder: labels.revealInFinder
  }

  return (
    <aside
      className="launcher-ai-sidebar-panel"
      aria-label={labels.expandSidebar}
      data-mode={mode}
      onPointerEnter={handlePanelPointerEnter}
      onPointerLeave={handlePanelPointerLeave}
    >
      <div className="launcher-ai-sidebar-panel__actions">
        <SidebarAction icon={<SquarePen />} label={labels.sidebarNewChat} onAction={onNewChat} />
        <SidebarAction icon={<Search />} label={labels.sidebarSearch} onAction={onOpenSearch} />
        <SidebarAction disabled icon={<Clock />} label={labels.sidebarAutomation} />
      </div>

      <div className="launcher-ai-sidebar-panel__section">
        <SectionHeading isOpen={isPinnedOpen} onToggle={() => toggleSection("pinned")}>
          {labels.sidebarPinned}
        </SectionHeading>
        {isPinnedOpen ? (
          pinnedThreads.length > 0 ? (
            pinnedThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                icon={<Pin />}
                locale={locale}
                menuActions={threadMenuActions}
                menuLabels={threadMenuLabels}
                onMenuOpenChange={handleThreadMenuOpenChange}
                thread={thread}
                onSelect={() => onSelectThread(thread.id)}
              />
            ))
          ) : (
            <EmptySectionRow>{labels.sidebarEmptyPinned}</EmptySectionRow>
          )
        ) : null}

        <SectionHeading
            actions={
              <ProjectSectionActions
                labels={projectSectionLabels}
                organizeMode={sidebarView?.preferences.organizeMode ?? "project"}
                sortBy={sidebarView?.preferences.sortBy ?? "updated"}
                onAddProject={onAddProject}
              onSetOrganizeMode={onSetSidebarOrganizeMode}
              onSetSortBy={onSetSidebarSortBy}
            />
          }
          isOpen={isProjectsOpen}
          onToggle={() => toggleSection("projects")}
        >
          {labels.sidebarProjects}
        </SectionHeading>
        {isProjectsOpen ? (
          projectGroups.length > 0 ? (
            projectGroups.map((group) => {
              const isProjectOpen =
                projectExpansionOverrides.get(group.key) ?? group.key === activeProjectKey

              return (
                <div className="launcher-ai-sidebar-panel__project-group" key={group.key}>
                  <ProjectFolderRow
                    actions={projectActions}
                    group={group}
                    isOpen={isProjectOpen}
                    labels={projectMenuLabels}
                    onToggle={() => toggleProject(group)}
                  />
                  {isProjectOpen
                    ? group.threads.map((thread) => (
                        <ThreadRow
                          depth="child"
                          icon={<MessageSquare />}
                          key={thread.id}
                          locale={locale}
                          menuActions={threadMenuActions}
                          menuLabels={threadMenuLabels}
                          onMenuOpenChange={handleThreadMenuOpenChange}
                          thread={thread}
                          onSelect={() => onSelectThread(thread.id)}
                        />
                      ))
                    : null}
                </div>
              )
            })
          ) : (
            <EmptySectionRow>{labels.sidebarEmptyProjects}</EmptySectionRow>
          )
        ) : null}

        <SectionHeading isOpen={isChatsOpen} onToggle={() => toggleSection("chats")}>
          {labels.sidebarChats}
        </SectionHeading>
        {isChatsOpen ? (
          chatThreads.length > 0 ? (
            chatThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                icon={<MessageSquare />}
                locale={locale}
                menuActions={threadMenuActions}
                menuLabels={threadMenuLabels}
                onMenuOpenChange={handleThreadMenuOpenChange}
                thread={thread}
                onSelect={() => onSelectThread(thread.id)}
              />
            ))
          ) : (
            <EmptySectionRow>{labels.sidebarEmptyRecent}</EmptySectionRow>
          )
        ) : null}
      </div>
    </aside>
  )
}

function mapSidebarThreadItem(
  thread: ThreadSidebarThreadItem,
  activeThreadId: string | null
): LauncherAiSidebarThreadItem {
  return {
    id: thread.threadId,
    isActive: thread.threadId === activeThreadId,
    isPinned: thread.isPinned,
    title: thread.title,
    updatedAt: thread.updatedAt,
    workspacePath: thread.workspacePath
  }
}

function mapSidebarProjectGroup(
  group: ThreadSidebarProjectGroup,
  activeThreadId: string | null
): LauncherAiSidebarProjectGroup {
  return {
    key: group.projectId,
    threads: group.threads.map((thread) => mapSidebarThreadItem(thread, activeThreadId)),
    title: group.title,
    workspacePath: group.workspacePath
  }
}
