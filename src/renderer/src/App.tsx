import { useEffect, useState, useCallback, useRef } from "react"
import { ThreadSidebar } from "@/components/sidebar/ThreadSidebar"
import { TabbedPanel, TabBar } from "@/components/tabs"
import { RightPanel } from "@/components/panels/RightPanel"
import { KanbanView, KanbanHeader } from "@/components/kanban"
import { ResizeHandle } from "@/components/ui/resizable"
import { useAppStore } from "@/lib/store"
import { ThreadProvider } from "@/lib/thread-context"
import { useI18n } from "@/lib/i18n"

const LEFT_MIN = 220
const LEFT_MAX = 350
const LEFT_DEFAULT = 240

const RIGHT_MIN = 250
const RIGHT_MAX = 450
const RIGHT_DEFAULT = 320

function App(): React.JSX.Element {
  const { currentThreadId, loadThreads, createThread, showKanbanView } = useAppStore()
  const { copy } = useI18n()
  const [isLoading, setIsLoading] = useState(true)
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)

  // Track drag start widths
  const dragStartWidths = useRef<{ left: number; right: number } | null>(null)

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

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        await loadThreads()
        // Create a default thread if none exist
        const threads = useAppStore.getState().threads
        if (threads.length === 0) {
          await createThread()
        }
      } catch (error) {
        console.error("Failed to initialize:", error)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [loadThreads, createThread])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{copy.app.initializing}</div>
      </div>
    )
  }

  return (
    <ThreadProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <div className="flex h-[52px] shrink-0 border-b border-border bg-[var(--window-chrome)] app-drag-region">
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
                  <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    {copy.app.selectThreadToBegin}
                  </div>
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
    </ThreadProvider>
  )
}

export default App
