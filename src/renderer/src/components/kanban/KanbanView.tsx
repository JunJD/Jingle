import { useMemo } from "react"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useAllThreadStates } from "@/lib/thread-context"
import {
  createEmptySubagentKanbanBuckets,
  projectSubagentKanbanBuckets,
  type WorkBoardStatus
} from "@/lib/subagent-view"
import { KanbanColumn } from "./KanbanColumn"
import { ThreadKanbanCard, SubagentKanbanCard } from "./KanbanCard"
import type { Thread } from "@/types"

type KanbanStatus = WorkBoardStatus

interface ThreadWithStatus {
  thread: Thread
  status: KanbanStatus
}

function getThreadKanbanStatus(
  thread: Thread,
  hasActiveRun: boolean,
  hasPendingApproval: boolean
): KanbanStatus {
  if (hasPendingApproval || thread.status === "interrupted") return "interrupted"
  if (thread.status === "busy" || hasActiveRun) return "in_progress"
  return "done"
}

export function KanbanView(): React.JSX.Element {
  const threads = useHistoryShellStore((state) => state.threads)
  const selectThread = useHistoryShellStore((state) => state.selectThread)
  const showSubagentsInKanban = useHistoryShellStore((state) => state.showSubagentsInKanban)
  const allThreadStates = useAllThreadStates()

  const handleCardClick = (threadId: string): void => {
    selectThread(threadId)
  }

  const categorizedThreads = useMemo(() => {
    const result: Record<KanbanStatus, ThreadWithStatus[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: []
    }

    for (const thread of threads) {
      const threadState = allThreadStates[thread.thread_id]
      const hasActiveRun = threadState?.agent.activeRun?.status === "running"
      const hasPendingApproval = Boolean(threadState?.agent.pendingApproval)
      const status = getThreadKanbanStatus(thread, hasActiveRun, hasPendingApproval)
      result[status].push({ thread, status })
    }

    return result
  }, [threads, allThreadStates])

  const categorizedSubagents = useMemo(() => {
    if (!showSubagentsInKanban) {
      return createEmptySubagentKanbanBuckets()
    }

    return projectSubagentKanbanBuckets({
      enabled: true,
      statesByThreadId: allThreadStates,
      threads
    })
  }, [threads, allThreadStates, showSubagentsInKanban])

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
            const threadItems = categorizedThreads[status]
            const subagentItems = categorizedSubagents[status]
            const totalCount = threadItems.length + subagentItems.length

            return (
              <KanbanColumn key={status} title={title} status={status} count={totalCount}>
                {threadItems.map(({ thread, status: threadStatus }) => (
                  <ThreadKanbanCard
                    key={thread.thread_id}
                    thread={thread}
                    status={threadStatus}
                    onClick={() => handleCardClick(thread.thread_id)}
                  />
                ))}
                {subagentItems.map(({ subagent, parentThread }) => (
                  <SubagentKanbanCard
                    key={subagent.id}
                    subagent={subagent}
                    parentThread={parentThread}
                    onClick={() => handleCardClick(parentThread.thread_id)}
                  />
                ))}
                {totalCount === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">No items</div>
                )}
              </KanbanColumn>
            )
          })}
        </div>
      </div>
    </div>
  )
}
