import { useEffect, useState, useCallback, useRef } from "react"
import { ThreadSidebar } from "@/components/sidebar/ThreadSidebar"
import { TabbedPanel, TabBar } from "@/components/tabs"
import { RightPanel } from "@/components/panels/RightPanel"
import { KanbanView, KanbanHeader } from "@/components/kanban"
import { HomeEntry } from "@/components/home/HomeEntry"
import { ResizeHandle } from "@/components/ui/resizable"
import {
  getCurrentHistoryThreadId,
  openHistoryThread,
  refreshHistoryThreadsAndReloadActive
} from "@/lib/history-thread-ops"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { ThreadProvider, useThreadContext } from "@/lib/thread-context"
import { useI18n } from "@/lib/i18n"

const LEFT_MIN = 220
const LEFT_MAX = 350
const LEFT_DEFAULT = 240

const RIGHT_MIN = 250
const RIGHT_MAX = 450
const RIGHT_DEFAULT = 320

interface MainAppContentProps {
  targetThreadId?: string
  onTargetThreadHandled?: (result: { matched: boolean; targetThreadId: string }) => void
}

function MainAppContent(props: MainAppContentProps): React.JSX.Element {
  const { onTargetThreadHandled, targetThreadId } = props
  const currentThreadId = useHistoryShellStore((state) => state.currentThreadId)
  const createThread = useHistoryShellStore((state) => state.createThread)
  const showKanbanView = useHistoryShellStore((state) => state.showKanbanView)
  const { reloadThread } = useThreadContext()
  const { copy } = useI18n()
  const [isLoading, setIsLoading] = useState(true)
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)

  // Track drag start widths
  const dragStartWidths = useRef<{ left: number; right: number } | null>(null)
  const hydratedThreadIdRef = useRef<string | null>(null)
  const handledTargetThreadIdRef = useRef<string | null>(null)
  const normalizedTargetThreadId = targetThreadId?.trim() || null
  const initialTargetThreadIdRef = useRef(normalizedTargetThreadId)

  const handleLeftResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth }
      }
      const newWidth = dragStartWidths.current.left + totalDelta
      setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, newWidth)))
    },
    [leftWidth, rightWidth]
  )

  const handleRightResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartWidths.current) {
        dragStartWidths.current = { left: leftWidth, right: rightWidth }
      }
      const newWidth = dragStartWidths.current.right - totalDelta
      setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, newWidth)))
    },
    [leftWidth, rightWidth]
  )

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartWidths.current = null
    }
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [])

  const openThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      hydratedThreadIdRef.current = threadId
      return openHistoryThread(threadId, reloadThread)
    },
    [reloadThread]
  )

  const handleTargetThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      const matched = await openThread(threadId)
      handledTargetThreadIdRef.current = threadId
      onTargetThreadHandled?.({ matched, targetThreadId: threadId })
      return matched
    },
    [onTargetThreadHandled, openThread]
  )

  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const threads = await refreshHistoryThreadsAndReloadActive(reloadThread)
        if (cancelled) {
          return
        }

        const activeThreadId = getCurrentHistoryThreadId()
        const initialTargetThreadId = initialTargetThreadIdRef.current

        if (initialTargetThreadId) {
          const matched = await handleTargetThread(initialTargetThreadId)
          if (cancelled) {
            return
          }
          if (matched) {
            return
          }
        }

        if (activeThreadId && threads.some((thread) => thread.thread_id === activeThreadId)) {
          hydratedThreadIdRef.current = activeThreadId
        } else if (threads.length > 0) {
          await openThread(threads[0]!.thread_id)
        } else {
          const thread = await createThread()
          if (cancelled) {
            return
          }
          hydratedThreadIdRef.current = thread.thread_id
          await reloadThread(thread.thread_id)
        }
      } catch (error) {
        console.error("Failed to initialize:", error)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    init()

    return () => {
      cancelled = true
    }
  }, [createThread, handleTargetThread, openThread, reloadThread])

  useEffect(() => {
    if (!normalizedTargetThreadId) {
      handledTargetThreadIdRef.current = null
      return
    }

    if (isLoading || normalizedTargetThreadId === handledTargetThreadIdRef.current) {
      return
    }

    void handleTargetThread(normalizedTargetThreadId)
  }, [handleTargetThread, isLoading, normalizedTargetThreadId])

  useEffect(() => {
    if (!currentThreadId || currentThreadId === hydratedThreadIdRef.current) {
      return
    }

    hydratedThreadIdRef.current = currentThreadId
    void reloadThread(currentThreadId).then(() => {
      hydratedThreadIdRef.current = currentThreadId
    })
  }, [currentThreadId, reloadThread])

  useEffect(() => {
    const handleWindowFocus = (): void => {
      void refreshHistoryThreadsAndReloadActive(reloadThread)
    }

    window.addEventListener("focus", handleWindowFocus)
    return () => {
      window.removeEventListener("focus", handleWindowFocus)
    }
  }, [reloadThread])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{copy.app.initializing}</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 border-b border-border bg-[var(--window-chrome)] app-drag-region">
        <div style={{ width: leftWidth }} className="shrink-0 border-r border-border bg-sidebar">
          <div
            className="flex h-full min-w-0 flex-col justify-center pr-4"
            style={{ paddingLeft: "calc(var(--window-controls-offset-inline) + 6px)" }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--window-chrome-muted)]">
              Openwork
            </div>
            <div className="truncate text-[13px] text-[var(--window-chrome-foreground)]">
              {copy.app.workspaceSubtitle}
            </div>
          </div>
        </div>

        <div className="w-[6px] shrink-0 bg-[var(--window-chrome)]" />

        <div className="min-w-0 flex-1 border-r border-border bg-[var(--window-chrome)]">
          {showKanbanView ? (
            <KanbanHeader className="h-full border-b-0 bg-transparent" />
          ) : currentThreadId ? (
            <TabBar className="h-full border-b-0 bg-transparent" />
          ) : (
            <div className="flex h-full items-center px-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--window-chrome-muted)]">
              {copy.app.conversation}
            </div>
          )}
        </div>

        {!showKanbanView && (
          <>
            <div className="w-[6px] shrink-0 bg-[var(--window-chrome)]" />
            <div style={{ width: rightWidth }} className="shrink-0 bg-[var(--window-chrome)]">
              <div className="flex h-full items-center justify-between px-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--window-chrome-muted)]">
                  {copy.app.inspector}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {copy.app.inspectorSummary}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: leftWidth }} className="shrink-0">
          <ThreadSidebar />
        </div>

        <ResizeHandle onDrag={handleLeftResize} />

        {showKanbanView ? (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <KanbanView />
          </main>
        ) : (
          <>
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {currentThreadId ? (
                <TabbedPanel threadId={currentThreadId} showTabBar={false} />
              ) : (
                <HomeEntry />
              )}
            </main>

            <ResizeHandle onDrag={handleRightResize} />

            <div style={{ width: rightWidth }} className="shrink-0">
              <RightPanel />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface HistoryAppProps {
  targetThreadId?: string
  onTargetThreadHandled?: (result: { matched: boolean; targetThreadId: string }) => void
}

function HistoryApp(props: HistoryAppProps): React.JSX.Element {
  const { onTargetThreadHandled, targetThreadId } = props

  return (
    <ThreadProvider>
      <MainAppContent
        onTargetThreadHandled={onTargetThreadHandled}
        targetThreadId={targetThreadId}
      />
    </ThreadProvider>
  )
}

export default HistoryApp
