import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadSelector } from "@/lib/thread-context"
import {
  getSubagentKanbanStatus,
  getThreadKanbanStatus,
  type WorkBoardStatus
} from "@/lib/subagent-view"
import { KanbanColumn } from "./KanbanColumn"
import { ThreadKanbanCard, SubagentKanbanCard } from "./KanbanCard"
import type { Subagent, Thread } from "@/types"

type KanbanStatus = WorkBoardStatus

const EMPTY_SUBAGENTS: readonly Subagent[] = []

function ThreadKanbanEntry(props: {
  onClick: (threadId: string) => void
  status: KanbanStatus
  thread: Thread
}): React.JSX.Element | null {
  const { onClick, status, thread } = props
  const hasActiveRun = useThreadSelector(
    thread.thread_id,
    (state) => state?.agent.activeRun?.status === "running"
  )
  const hasPendingApproval = useThreadSelector(thread.thread_id, (state) =>
    Boolean(state?.agent.pendingApproval)
  )
  const threadStatus = getThreadKanbanStatus({
    hasActiveRun,
    hasPendingApproval,
    threadStatus: thread.status
  })

  if (threadStatus !== status) {
    return null
  }

  return (
    <ThreadKanbanCard
      isLoading={hasActiveRun}
      thread={thread}
      status={threadStatus}
      onClick={() => onClick(thread.thread_id)}
    />
  )
}

function SubagentKanbanEntries(props: {
  enabled: boolean
  onClick: (threadId: string) => void
  status: KanbanStatus
  thread: Thread
}): React.JSX.Element | null {
  const { enabled, onClick, status, thread } = props
  const subagents = useThreadSelector(
    thread.thread_id,
    (state) => state?.agent.subagents ?? EMPTY_SUBAGENTS
  )

  if (!enabled) {
    return null
  }

  return (
    <>
      {subagents.map((subagent) =>
        getSubagentKanbanStatus(subagent.status) === status ? (
          <SubagentKanbanCard
            key={subagent.id}
            subagent={subagent}
            parentThread={thread}
            onClick={() => onClick(thread.thread_id)}
          />
        ) : null
      )}
    </>
  )
}

export function KanbanView(): React.JSX.Element {
  const threads = useHistoryShellStore((state) => state.threads)
  const selectThread = useHistoryShellStore((state) => state.selectThread)
  const showSubagentsInKanban = useHistoryShellStore((state) => state.showSubagentsInKanban)

  const handleCardClick = (threadId: string): void => {
    selectThread(threadId)
  }

  const columnData: { status: KanbanStatus; title: string }[] = [
    { status: "pending", title: "PENDING" },
    { status: "in_progress", title: "IN PROGRESS" },
    { status: "interrupted", title: "BLOCKED" },
    { status: "done", title: "DONE" }
  ]

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-x-auto p-2">
        <div className="flex h-full min-w-max gap-2">
          {columnData.map(({ status, title }) => {
            return (
              <KanbanColumn key={status} title={title} status={status}>
                {threads.map((thread) => (
                  <ThreadKanbanEntry
                    key={`thread:${thread.thread_id}`}
                    thread={thread}
                    status={status}
                    onClick={handleCardClick}
                  />
                ))}
                {threads.map((thread) => (
                  <SubagentKanbanEntries
                    key={`subagents:${thread.thread_id}`}
                    enabled={showSubagentsInKanban}
                    thread={thread}
                    status={status}
                    onClick={handleCardClick}
                  />
                ))}
              </KanbanColumn>
            )
          })}
        </div>
      </div>
    </div>
  )
}
