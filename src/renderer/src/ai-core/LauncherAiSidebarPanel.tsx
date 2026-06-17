import { MessageSquare, Pin } from "lucide-react"
import type { ReactNode } from "react"
import { isThreadPinned } from "@shared/thread-sidebar"
import { formatRelativeTime } from "@/lib/utils"
import type { AppLocale } from "@shared/i18n"
import type { Thread } from "@/types"

export interface LauncherAiSidebarInfo {
  modelLabel: string | null
  permissionLabel: string
  threadId: string | null
  title: string
  workspacePath: string | null
}

export interface LauncherAiSidebarThreadItem {
  id: string
  isActive: boolean
  isPinned: boolean
  title: string
  updatedAt: Date
}

interface LauncherAiSidebarPanelProps {
  info: LauncherAiSidebarInfo
  labels: {
    environmentModel: string
    environmentNoModel: string
    environmentNoThread: string
    environmentNoWorkspace: string
    environmentPermission: string
    environmentThread: string
    environmentWorkspace: string
    expandSidebar: string
    sidebarChats: string
    sidebarEmptyPinned: string
    sidebarEmptyRecent: string
    sidebarPinned: string
  }
  locale: AppLocale
  mode: "expanded" | "preview"
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onSelectThread: (threadId: string) => void
  threads: readonly LauncherAiSidebarThreadItem[]
}

function getFolderName(folderPath: string | null): string | null {
  if (!folderPath) {
    return null
  }

  const normalized = folderPath.replace(/[\\/]+$/, "")
  const parts = normalized.split(/[\\/]+/)
  return parts.at(-1) || normalized
}

function FactRow(props: { label: string; title?: string; value: string }): React.JSX.Element {
  const { label, title, value } = props

  return (
    <div className="launcher-ai-sidebar-panel__fact">
      <span className="launcher-ai-sidebar-panel__fact-label">{label}</span>
      <span className="launcher-ai-sidebar-panel__fact-value" title={title ?? value}>
        {value}
      </span>
    </div>
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
      <span className="launcher-ai-sidebar-panel__thread-copy">
        <span className="launcher-ai-sidebar-panel__thread-title">{thread.title}</span>
        <span className="launcher-ai-sidebar-panel__thread-meta">
          {formatRelativeTime(thread.updatedAt, locale)}
        </span>
      </span>
    </button>
  )
}

export function LauncherAiSidebarPanel(props: LauncherAiSidebarPanelProps): React.JSX.Element {
  const {
    info,
    labels,
    locale,
    mode,
    onPointerEnter,
    onPointerLeave,
    onSelectThread,
    threads
  } = props
  const workspaceName = getFolderName(info.workspacePath) ?? labels.environmentNoWorkspace
  const modelLabel = info.modelLabel ?? labels.environmentNoModel
  const threadLabel = info.threadId ?? labels.environmentNoThread
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
      <div className="launcher-ai-sidebar-panel__current">
        <div className="launcher-ai-sidebar-panel__title" title={info.title}>
          {info.title}
        </div>
        <FactRow
          label={labels.environmentWorkspace}
          title={info.workspacePath ?? workspaceName}
          value={workspaceName}
        />
        <FactRow label={labels.environmentThread} value={threadLabel} />
        <FactRow label={labels.environmentModel} value={modelLabel} />
        <FactRow label={labels.environmentPermission} value={info.permissionLabel} />
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
