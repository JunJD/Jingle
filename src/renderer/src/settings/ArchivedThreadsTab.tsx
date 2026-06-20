import { useEffect, useMemo, useState } from "react"
import { Archive, Folder, MessageSquare, RotateCcw, Search, Trash2 } from "lucide-react"
import type { ArchivedThreadItem, ArchivedThreadsView } from "@shared/thread-archive"
import type { AppLocale } from "@shared/i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/utils"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  secondaryButtonClassName,
  selectClassName,
  settingsCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName
} from "./settings-ui"

type ProjectFilterValue = "all" | "projectless" | `project:${string}`
type DeleteConfirmation =
  | {
      kind: "single"
      thread: ArchivedThreadItem
    }
  | {
      count: number
      kind: "visible"
      threadIds: string[]
    }

function getProjectFilterValue(projectId: string): ProjectFilterValue {
  return `project:${projectId}`
}

function getThreadProjectLabel(
  thread: ArchivedThreadItem,
  view: ArchivedThreadsView,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (thread.workspaceKind === "projectless" || !thread.projectId) {
    return copy.archived.projectless
  }

  const project = view.projects.find((entry) => entry.projectId === thread.projectId)
  return project?.displayName ?? thread.workspacePath ?? copy.archived.unknownProject
}

function matchesProjectFilter(thread: ArchivedThreadItem, filter: ProjectFilterValue): boolean {
  if (filter === "all") {
    return true
  }

  if (filter === "projectless") {
    return thread.workspaceKind === "projectless" || !thread.projectId
  }

  return thread.projectId === filter.slice("project:".length)
}

function matchesSearchQuery(
  thread: ArchivedThreadItem,
  query: string,
  projectLabel: string
): boolean {
  if (!query) {
    return true
  }

  const haystack = `${thread.title} ${thread.workspacePath ?? ""} ${projectLabel}`.toLowerCase()
  return haystack.includes(query)
}

export function ArchivedThreadsTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [view, setView] = useState<ArchivedThreadsView | null>(null)
  const [query, setQuery] = useState("")
  const [projectFilter, setProjectFilter] = useState<ProjectFilterValue>("all")
  const [status, setStatus] = useState("")
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadArchivedThreads = async (): Promise<void> => {
    const nextView = await window.api.threads.listArchived()
    setView(nextView)
  }

  useEffect(() => {
    void loadArchivedThreads()
  }, [])

  const visibleThreads = useMemo(() => {
    if (!view) {
      return []
    }

    const normalizedQuery = query.trim().toLowerCase()
    return view.threads.filter((thread) => {
      const projectLabel = getThreadProjectLabel(thread, view, copy)
      return (
        matchesProjectFilter(thread, projectFilter) &&
        matchesSearchQuery(thread, normalizedQuery, projectLabel)
      )
    })
  }, [copy, projectFilter, query, view])

  const restoreThread = async (threadId: string): Promise<void> => {
    await window.api.threads.setArchived(threadId, false)
    await loadArchivedThreads()
    setStatus(copy.archived.restored)
  }

  const deleteThread = async (thread: ArchivedThreadItem): Promise<void> => {
    await window.api.threads.delete(thread.threadId)
    await loadArchivedThreads()
    setStatus(copy.archived.deleted)
  }

  const deleteVisibleThreads = async (threadIds: string[]): Promise<void> => {
    for (const threadId of threadIds) {
      await window.api.threads.delete(threadId)
    }
    await loadArchivedThreads()
    setStatus(copy.archived.deletedAll(threadIds.length))
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteConfirmation) {
      return
    }

    setIsDeleting(true)
    try {
      if (deleteConfirmation.kind === "single") {
        await deleteThread(deleteConfirmation.thread)
      } else {
        await deleteVisibleThreads(deleteConfirmation.threadIds)
      }
      setDeleteConfirmation(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const deleteDialogTitle =
    deleteConfirmation?.kind === "single"
      ? copy.archived.confirmDeleteTitle
      : copy.archived.confirmDeleteVisibleTitle
  const deleteDialogDescription =
    deleteConfirmation?.kind === "single"
      ? copy.archived.confirmDeleteDescription(deleteConfirmation.thread.title)
      : deleteConfirmation
        ? copy.archived.confirmDeleteVisibleDescription(deleteConfirmation.count)
        : ""

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
        {copy.archived.loading}
      </div>
    )
  }

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className="flex items-start justify-between gap-[var(--ow-gap-md)]">
          <div className="min-w-0">
            <div className={settingsPageTitleClassName}>{copy.archived.title}</div>
            <div className={settingsPageDescriptionClassName}>{copy.archived.description}</div>
          </div>
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={visibleThreads.length === 0}
            onClick={() => {
              setDeleteConfirmation({
                count: visibleThreads.length,
                kind: "visible",
                threadIds: visibleThreads.map((thread) => thread.threadId)
              })
            }}
          >
            <Trash2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
            {copy.archived.deleteVisible}
          </button>
        </div>
      </div>

      <div className={settingsCardClassName}>
        <div className="grid gap-[var(--ow-gap-md)] border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-[var(--ow-space-3)] top-1/2 h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputClassName} pl-[calc(var(--ow-space-3)*2+var(--ow-icon-action))]`}
              placeholder={copy.archived.searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <select
            className={selectClassName}
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.currentTarget.value as ProjectFilterValue)}
          >
            <option value="all">{copy.archived.allProjects}</option>
            <option value="projectless">{copy.archived.projectless}</option>
            {view.projects.map((project) => (
              <option key={project.projectId} value={getProjectFilterValue(project.projectId)}>
                {project.displayName}
              </option>
            ))}
          </select>
        </div>

        {visibleThreads.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-[var(--ow-gap-sm)] px-[var(--ow-settings-card-x)] py-[var(--ow-space-8)] text-center">
            <Archive className="h-8 w-8 text-muted-foreground" />
            <div className="[font-size:var(--ow-font-label)] font-medium text-foreground">
              {copy.archived.emptyTitle}
            </div>
            <div className="max-w-[360px] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
              {copy.archived.emptyDescription}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {visibleThreads.map((thread) => {
              const projectLabel = getThreadProjectLabel(thread, view, copy)

              return (
                <div
                  key={thread.threadId}
                  className="group grid gap-[var(--ow-gap-md)] px-[var(--ow-settings-card-x)] py-[var(--ow-space-3)] transition hover:bg-background/70 md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-[var(--ow-space-1)]">
                    <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
                      <MessageSquare className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] shrink-0 text-muted-foreground" />
                      <div className="min-w-0 truncate [font-size:var(--ow-font-label)] font-semibold text-foreground">
                        {thread.title}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-[var(--ow-gap-md)] gap-y-[var(--ow-space-1)] pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))] [font-size:var(--ow-font-meta)] text-muted-foreground">
                      <span>{formatRelativeTime(thread.archivedAt, locale)}</span>
                      <span className="inline-flex min-w-0 items-center gap-[var(--ow-space-1)]">
                        <Folder className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)] shrink-0" />
                        <span className="min-w-0 truncate">{projectLabel}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-[var(--ow-space-2)]">
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      title={copy.archived.restore}
                      onClick={() => {
                        void restoreThread(thread.threadId)
                      }}
                    >
                      <RotateCcw className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
                      {copy.archived.restore}
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      title={copy.archived.delete}
                      onClick={() => {
                        setDeleteConfirmation({
                          kind: "single",
                          thread
                        })
                      }}
                    >
                      <Trash2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
                      {copy.archived.delete}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {status ? (
        <div className="[font-size:var(--ow-font-meta)] text-muted-foreground">{status}</div>
      ) : null}

      <Dialog
        open={deleteConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteConfirmation(null)
          }
        }}
      >
        <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[var(--ow-dialog-w-sm)] sm:rounded-[var(--ow-radius-dialog)]">
          <DialogHeader className="text-left">
            <DialogTitle>{deleteDialogTitle}</DialogTitle>
            <DialogDescription>{deleteDialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-[var(--ow-space-2)]">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteConfirmation(null)}
            >
              {copy.archived.confirmCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => {
                void confirmDelete()
              }}
            >
              <Trash2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
              {copy.archived.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
