import { useMemo } from "react"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useAllThreadStates, useAllStreamLoadingStates } from "@/lib/thread-context"
import { KanbanColumn } from "./KanbanColumn"
import { ThreadKanbanCard, SubagentKanbanCard } from "./KanbanCard"
import type { Thread, Subagent } from "@/types"

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done"

interface ThreadWithStatus {
  thread: Thread
  status: KanbanStatus
}

interface SubagentWithParent {
  subagent: Subagent
  parentThread: Thread
  status: KanbanStatus
}

function getThreadKanbanStatus(
  thread: Thread,
  isLoading: boolean,
  hasDraft: boolean,
  hasPendingApproval: boolean
): KanbanStatus {
  if (hasPendingApproval || thread.status === "interrupted") return "interrupted"
  if (thread.status === "busy" || isLoading) return "in_progress"
  if (hasDraft) return "pending"
  return "done"
}

export function KanbanView(): React.JSX.Element {
  const { threads, selectThread, showSubagentsInKanban } = useHistoryShellStore()
  const allThreadStates = useAllThreadStates()
  const loadingStates = useAllStreamLoadingStates()

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
      const isLoading = loadingStates[thread.thread_id] ?? false
      const threadState = allThreadStates[thread.thread_id]
      const hasDraft = Boolean(threadState?.draftInput?.trim())
      const hasPendingApproval = Boolean(threadState?.pendingApproval)
      const status = getThreadKanbanStatus(thread, isLoading, hasDraft, hasPendingApproval)
      result[status].push({ thread, status })
    }

    return result
  }, [threads, loadingStates, allThreadStates])

  const categorizedSubagents = useMemo(() => {
    if (!showSubagentsInKanban) {
      return { pending: [], in_progress: [], interrupted: [], done: [] }
    }

    const result: Record<KanbanStatus, SubagentWithParent[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: []
    }

    const threadMap = new Map(threads.map((t) => [t.thread_id, t]))

    for (const [threadId, state] of Object.entries(allThreadStates)) {
      const parentThread = threadMap.get(threadId)
      if (!parentThread || !state.subagents) continue

      for (const subagent of state.subagents) {
        let status: KanbanStatus
        switch (subagent.status) {
          case "pending":
            status = "pending"
            break
          case "running":
            status = "in_progress"
            break
          case "completed":
            status = "done"
            break
          case "failed":
            status = "done"
            break
          default:
            status = "pending"
        }

        result[status].push({ subagent, parentThread, status })
      }
    }

    return result
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
