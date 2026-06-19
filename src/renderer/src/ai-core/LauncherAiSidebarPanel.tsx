import { Clock, MessageSquare, Pin, Search, SquarePen } from "lucide-react"
import type { ReactNode } from "react"
import { isThreadPinned } from "@shared/thread-sidebar"
import { formatRelativeTime } from "@/lib/utils"
import type { AppLocale } from "@shared/i18n"
import type { Thread } from "@/types"

export interface LauncherAiSidebarThreadItem {
  id: string
  isActive: boolean
  isPinned: boolean
  title: string
  updatedAt: Date
}

interface LauncherAiSidebarPanelProps {
  labels: {
    expandSidebar: string
    sidebarAutomation: string
    sidebarChats: string
    sidebarEmptyPinned: string
    sidebarEmptyRecent: string
    sidebarNewChat: string
    sidebarPinned: string
    sidebarSearch: string
  }
  locale: AppLocale
  mode: "expanded" | "preview"
  onNewChat: () => void
  onOpenSearch: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onSelectThread: (threadId: string) => void
  threads: readonly LauncherAiSidebarThreadItem[]
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

function SectionHeading(props: { children: ReactNode }): React.JSX.Element {
  return <div className="launcher-ai-sidebar-panel__section-heading">{props.children}</div>
}

function EmptySectionRow(props: { children: ReactNode }): React.JSX.Element {
  return <div className="launcher-ai-sidebar-panel__empty">{props.children}</div>
}

function ThreadRow(props: {
  icon: ReactNode
  locale: AppLocale
  onSelect: () => void
  thread: LauncherAiSidebarThreadItem
}): React.JSX.Element {
  const { icon, locale, onSelect, thread } = props

  return (
    <button
      type="button"
      className="launcher-ai-sidebar-panel__thread"
      data-active={thread.isActive ? "" : undefined}
      title={thread.title}
      onClick={onSelect}
    >
      <span className="launcher-ai-sidebar-panel__thread-icon">{icon}</span>
      <span className="launcher-ai-sidebar-panel__thread-title">{thread.title}</span>
      <span className="launcher-ai-sidebar-panel__thread-meta">
        {formatRelativeTime(thread.updatedAt, locale)}
      </span>
    </button>
  )
}

export function LauncherAiSidebarPanel(props: LauncherAiSidebarPanelProps): React.JSX.Element {
  const {
    labels,
    locale,
    mode,
    onNewChat,
    onOpenSearch,
    onPointerEnter,
    onPointerLeave,
    onSelectThread,
    threads
  } = props
  const pinnedThreads = threads.filter((thread) => thread.isPinned)
  const recentThreads = threads.filter((thread) => !thread.isPinned)

  return (
    <aside
      className="launcher-ai-sidebar-panel"
      aria-label={labels.expandSidebar}
      data-mode={mode}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="launcher-ai-sidebar-panel__actions">
        <SidebarAction icon={<SquarePen />} label={labels.sidebarNewChat} onAction={onNewChat} />
        <SidebarAction icon={<Search />} label={labels.sidebarSearch} onAction={onOpenSearch} />
        <SidebarAction disabled icon={<Clock />} label={labels.sidebarAutomation} />
      </div>

      <div className="launcher-ai-sidebar-panel__section">
        <SectionHeading>{labels.sidebarPinned}</SectionHeading>
        {pinnedThreads.length > 0 ? (
          pinnedThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              icon={<Pin />}
              locale={locale}
              thread={thread}
              onSelect={() => onSelectThread(thread.id)}
            />
          ))
        ) : (
          <EmptySectionRow>{labels.sidebarEmptyPinned}</EmptySectionRow>
        )}

        <SectionHeading>{labels.sidebarChats}</SectionHeading>
        {recentThreads.length > 0 ? (
          recentThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              icon={<MessageSquare />}
              locale={locale}
              thread={thread}
              onSelect={() => onSelectThread(thread.id)}
            />
          ))
        ) : (
          <EmptySectionRow>{labels.sidebarEmptyRecent}</EmptySectionRow>
        )}
      </div>
    </aside>
  )
}

export function mapThreadToLauncherAiSidebarItem(
  thread: Thread,
  activeThreadId: string | null
): LauncherAiSidebarThreadItem {
  return {
    id: thread.thread_id,
    isActive: thread.thread_id === activeThreadId,
    isPinned: isThreadPinned(thread.metadata),
    title: thread.title?.trim() || thread.thread_id,
    updatedAt: thread.updated_at
  }
}
