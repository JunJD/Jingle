import { useEffect, useMemo, useReducer } from "react"
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
  settingsCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsSelect
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

function getDeleteDialogTitle(
  deleteConfirmation: DeleteConfirmation | null,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (deleteConfirmation?.kind === "single") {
    return copy.archived.confirmDeleteTitle
  }

  return copy.archived.confirmDeleteVisibleTitle
}

function getDeleteDialogDescription(
  deleteConfirmation: DeleteConfirmation | null,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (!deleteConfirmation) {
    return ""
  }

  if (deleteConfirmation.kind === "single") {
    return copy.archived.confirmDeleteDescription(deleteConfirmation.thread.title)
  }

  return copy.archived.confirmDeleteVisibleDescription(deleteConfirmation.count)
}

interface ArchivedThreadsTabState {
  deleteConfirmation: DeleteConfirmation | null
  isDeleting: boolean
  projectFilter: ProjectFilterValue
  query: string
  status: string
  view: ArchivedThreadsView | null
}

type ArchivedThreadsTabAction =
  | { type: "delete-confirmation-changed"; deleteConfirmation: DeleteConfirmation | null }
  | { type: "delete-finished" }
  | { type: "delete-started" }
  | { type: "project-filter-changed"; projectFilter: ProjectFilterValue }
  | { type: "query-changed"; query: string }
  | { type: "status-changed"; status: string }
  | { type: "view-loaded"; view: ArchivedThreadsView }

const initialArchivedThreadsTabState: ArchivedThreadsTabState = {
  deleteConfirmation: null,
  isDeleting: false,
  projectFilter: "all",
  query: "",
  status: "",
  view: null
}

function archivedThreadsTabReducer(
  state: ArchivedThreadsTabState,
  action: ArchivedThreadsTabAction
): ArchivedThreadsTabState {
  switch (action.type) {
    case "delete-confirmation-changed":
      return { ...state, deleteConfirmation: action.deleteConfirmation }
    case "delete-finished":
      return { ...state, isDeleting: false }
    case "delete-started":
      return { ...state, isDeleting: true }
    case "project-filter-changed":
      return { ...state, projectFilter: action.projectFilter }
    case "query-changed":
      return { ...state, query: action.query }
    case "status-changed":
      return { ...state, status: action.status }
    case "view-loaded":
      return { ...state, view: action.view }
  }
}

export function ArchivedThreadsTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [state, dispatch] = useReducer(
    archivedThreadsTabReducer,
    initialArchivedThreadsTabState
  )
  const { deleteConfirmation, isDeleting, projectFilter, query, status, view } = state

  const loadArchivedThreads = async (): Promise<void> => {
    const nextView = await window.api.threads.listArchived()
    dispatch({ type: "view-loaded", view: nextView })
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
    dispatch({ type: "status-changed", status: copy.archived.restored })
  }

  const deleteThread = async (thread: ArchivedThreadItem): Promise<void> => {
    await window.api.threads.delete(thread.threadId)
    await loadArchivedThreads()
    dispatch({ type: "status-changed", status: copy.archived.deleted })
  }

  const deleteVisibleThreads = async (threadIds: string[]): Promise<void> => {
    for (const threadId of threadIds) {
      await window.api.threads.delete(threadId)
    }
    await loadArchivedThreads()
    dispatch({ type: "status-changed", status: copy.archived.deletedAll(threadIds.length) })
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteConfirmation) {
      return
    }

    dispatch({ type: "delete-started" })
    try {
      if (deleteConfirmation.kind === "single") {
        await deleteThread(deleteConfirmation.thread)
      } else {
        await deleteVisibleThreads(deleteConfirmation.threadIds)
      }
      dispatch({ type: "delete-confirmation-changed", deleteConfirmation: null })
    } finally {
      dispatch({ type: "delete-finished" })
    }
  }

  const deleteDialogTitle = getDeleteDialogTitle(deleteConfirmation, copy)
  const deleteDialogDescription = getDeleteDialogDescription(deleteConfirmation, copy)

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--jingle-font-label)] text-muted-foreground">
        {copy.archived.loading}
      </div>
    )
  }

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className="flex items-start justify-between gap-[var(--jingle-gap-md)]">
          <div className="min-w-0">
            <div className={settingsPageTitleClassName}>{copy.archived.title}</div>
            <div className={settingsPageDescriptionClassName}>{copy.archived.description}</div>
          </div>
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={visibleThreads.length === 0}
            onClick={() => {
              dispatch({
                type: "delete-confirmation-changed",
                deleteConfirmation: {
                  count: visibleThreads.length,
                  kind: "visible",
                  threadIds: visibleThreads.map((thread) => thread.threadId)
                }
              })
            }}
          >
            <Trash2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
            {copy.archived.deleteVisible}
          </button>
        </div>
      </div>

      <div className={settingsCardClassName}>
        <div className="grid gap-[var(--jingle-gap-md)] border-b border-border/70 px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)] md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-[var(--jingle-space-3)] top-1/2 h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputClassName} pl-[calc(var(--jingle-space-3)*2+var(--jingle-icon-action))]`}
              placeholder={copy.archived.searchPlaceholder}
              value={query}
              onChange={(event) =>
                dispatch({ type: "query-changed", query: event.currentTarget.value })
              }
            />
          </label>

          <SettingsSelect
            aria-label={copy.archived.projectFilterLabel}
            value={projectFilter}
            onChange={(event) =>
              dispatch({
                type: "project-filter-changed",
                projectFilter: event.currentTarget.value as ProjectFilterValue
              })
            }
          >
            <option value="all">{copy.archived.allProjects}</option>
            <option value="projectless">{copy.archived.projectless}</option>
            {view.projects.map((project) => (
              <option key={project.projectId} value={getProjectFilterValue(project.projectId)}>
                {project.displayName}
              </option>
            ))}
          </SettingsSelect>
        </div>

        {visibleThreads.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-[var(--jingle-gap-sm)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-space-8)] text-center">
            <Archive className="h-8 w-8 text-muted-foreground" />
            <div className="[font-size:var(--jingle-font-label)] font-medium text-foreground">
              {copy.archived.emptyTitle}
            </div>
            <div className="max-w-[360px] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
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
                  className="group grid gap-[var(--jingle-gap-md)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-space-3)] transition hover:bg-background/70 md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-[var(--jingle-space-1)]">
                    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)]">
                      <MessageSquare className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] shrink-0 text-muted-foreground" />
                      <div className="min-w-0 truncate [font-size:var(--jingle-font-label)] font-semibold text-foreground">
                        {thread.title}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-[var(--jingle-gap-md)] gap-y-[var(--jingle-space-1)] pl-[calc(var(--jingle-icon-action)+var(--jingle-gap-sm))] [font-size:var(--jingle-font-meta)] text-muted-foreground">
                      <span>{formatRelativeTime(thread.archivedAt, locale)}</span>
                      <span className="inline-flex min-w-0 items-center gap-[var(--jingle-space-1)]">
                        <Folder className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)] shrink-0" />
                        <span className="min-w-0 truncate">{projectLabel}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-[var(--jingle-space-2)]">
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      title={copy.archived.restore}
                      onClick={() => {
                        void restoreThread(thread.threadId)
                      }}
                    >
                      <RotateCcw className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
                      {copy.archived.restore}
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      title={copy.archived.delete}
                      onClick={() => {
                        dispatch({
                          type: "delete-confirmation-changed",
                          deleteConfirmation: {
                            kind: "single",
                            thread
                          }
                        })
                      }}
                    >
                      <Trash2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
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
        <div className="[font-size:var(--jingle-font-meta)] text-muted-foreground">{status}</div>
      ) : null}

      <Dialog
        open={deleteConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            dispatch({ type: "delete-confirmation-changed", deleteConfirmation: null })
          }
        }}
      >
        <DialogContent className="w-[var(--jingle-dialog-mobile-w)] rounded-[var(--jingle-radius-dialog)] sm:max-w-[var(--jingle-dialog-w-sm)] sm:rounded-[var(--jingle-radius-dialog)]">
          <DialogHeader className="text-left">
            <DialogTitle>{deleteDialogTitle}</DialogTitle>
            <DialogDescription>{deleteDialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-[var(--jingle-space-2)]">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() =>
                dispatch({ type: "delete-confirmation-changed", deleteConfirmation: null })
              }
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
              <Trash2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
              {copy.archived.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
