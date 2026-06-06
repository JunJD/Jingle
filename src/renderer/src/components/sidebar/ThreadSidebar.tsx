import { useState } from "react"
import { Plus, MessageSquare, Trash2, Pencil, Loader2, LayoutGrid, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadSelector } from "@/lib/thread-context"
import { cn, formatRelativeTime, truncate } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import type { Thread } from "@/types"

// Thread status indicator that shows loading, interrupted, or default state
function ThreadStatusIcon({ threadId }: { threadId: string }): React.JSX.Element {
  const isLoading = useThreadSelector(threadId, (state) => state?.agent.activeRun?.status === "running")
  const pendingApproval = useThreadSelector(threadId, (state) => state?.agent.pendingApproval ?? null)

  if (isLoading) {
    return (
      <Loader2 className="size-[var(--ow-icon-action)] shrink-0 text-status-info animate-spin" />
    )
  }

  if (pendingApproval) {
    return <AlertCircle className="size-[var(--ow-icon-action)] shrink-0 text-status-warning" />
  }

  return <MessageSquare className="size-[var(--ow-icon-action)] shrink-0 text-muted-foreground" />
}

// Individual thread list item component
function ThreadListItem({
  thread,
  isSelected,
  isEditing,
  editingTitle,
  onSelect,
  onDelete,
  onStartEditing,
  onSaveTitle,
  onCancelEditing,
  onEditingTitleChange,
  locale,
  renameLabel,
  deleteLabel
}: {
  thread: Thread
  isSelected: boolean
  isEditing: boolean
  editingTitle: string
  onSelect: () => void
  onDelete: () => void
  onStartEditing: () => void
  onSaveTitle: () => void
  onCancelEditing: () => void
  onEditingTitleChange: (value: string) => void
  locale: "zh-CN" | "en-US"
  renameLabel: string
  deleteLabel: string
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-thread-id={thread.thread_id}
          data-thread-selected={isSelected ? "true" : "false"}
          className={cn(
            "group flex cursor-pointer items-start gap-[var(--ow-gap-md)] overflow-hidden border-t border-border px-[var(--ow-space-3)] py-[var(--ow-space-3)] transition-colors first:border-t-0",
            isSelected
              ? "bg-sidebar-accent/45 text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
              : "hover:bg-sidebar-accent/25"
          )}
          onClick={() => {
            if (!isEditing) {
              onSelect()
            }
          }}
        >
          <ThreadStatusIcon threadId={thread.thread_id} />
          <div className="flex-1 min-w-0 overflow-hidden">
            {isEditing ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => onEditingTitleChange(e.target.value)}
                onBlur={onSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveTitle()
                  if (e.key === "Escape") onCancelEditing()
                }}
                className="w-full rounded-[var(--ow-radius-lg)] border border-border bg-background-elevated px-[var(--ow-space-2)] py-[var(--ow-space-1)] [font-size:var(--ow-font-body)] outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="block truncate [font-size:var(--ow-font-body)]">
                  {thread.title || truncate(thread.thread_id, 20)}
                </div>
                <div className="truncate [font-size:var(--ow-font-caption)] text-muted-foreground">
                  {formatRelativeTime(thread.updated_at, locale)}
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-[var(--ow-space-0-5)] shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-[var(--ow-icon-compact)]" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartEditing}>
          <Pencil className="mr-[var(--ow-space-2)] size-[var(--ow-icon-action)]" />
          {renameLabel}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="mr-[var(--ow-space-2)] size-[var(--ow-icon-action)]" />
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ThreadSidebar(): React.JSX.Element {
  const { copy, locale } = useI18n()
  const threads = useHistoryShellStore((state) => state.threads)
  const currentThreadId = useHistoryShellStore((state) => state.currentThreadId)
  const createThread = useHistoryShellStore((state) => state.createThread)
  const selectThread = useHistoryShellStore((state) => state.selectThread)
  const deleteThread = useHistoryShellStore((state) => state.deleteThread)
  const updateThread = useHistoryShellStore((state) => state.updateThread)
  const setShowKanbanView = useHistoryShellStore((state) => state.setShowKanbanView)

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  const startEditing = (threadId: string, currentTitle: string): void => {
    setEditingThreadId(threadId)
    setEditingTitle(currentTitle || "")
  }

  const saveTitle = async (): Promise<void> => {
    if (editingThreadId && editingTitle.trim()) {
      await updateThread(editingThreadId, { title: editingTitle.trim() })
    }
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const cancelEditing = (): void => {
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const handleNewThread = async (): Promise<void> => {
    await createThread()
  }

  const handleDeleteThread = async (threadId: string): Promise<void> => {
    try {
      await deleteThread(threadId)
    } catch (error) {
      console.error("[ThreadSidebar] Failed to delete thread:", error)
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
      <div className="border-b border-border px-[var(--ow-space-3)] py-[var(--ow-space-3)]">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-[var(--ow-gap-sm)] rounded-full bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={handleNewThread}
        >
          <Plus className="size-[var(--ow-icon-action)]" />
          {copy.sidebar.newThread}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="overflow-hidden px-[var(--ow-space-3)] py-[var(--ow-space-2)]">
          {threads.map((thread) => (
            <ThreadListItem
              key={thread.thread_id}
              thread={thread}
              isSelected={currentThreadId === thread.thread_id}
              isEditing={editingThreadId === thread.thread_id}
              editingTitle={editingTitle}
              onSelect={() => selectThread(thread.thread_id)}
              onDelete={() => {
                void handleDeleteThread(thread.thread_id)
              }}
              onStartEditing={() => startEditing(thread.thread_id, thread.title || "")}
              onSaveTitle={saveTitle}
              onCancelEditing={cancelEditing}
              onEditingTitleChange={setEditingTitle}
              locale={locale}
              renameLabel={copy.sidebar.rename}
              deleteLabel={copy.sidebar.delete}
            />
          ))}

          {threads.length === 0 && (
            <div className="px-[var(--ow-space-3)] py-[var(--ow-space-8)] text-center [font-size:var(--ow-font-body)] text-muted-foreground">
              {copy.sidebar.noThreads}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-[var(--ow-space-3)] py-[var(--ow-space-3)]">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-[var(--ow-gap-sm)] rounded-full text-sidebar-foreground hover:bg-sidebar-accent/60"
          onClick={() => setShowKanbanView(true)}
        >
          <LayoutGrid className="size-[var(--ow-icon-action)]" />
          {copy.sidebar.overview}
        </Button>
      </div>
    </aside>
  )
}
