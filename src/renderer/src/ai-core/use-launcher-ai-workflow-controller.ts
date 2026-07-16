import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CreateProjectWorkflowLabelInput,
  CreateProjectWorkflowStatusInput,
  ProjectWorkflowDefinition,
  ThreadWorkflowView
} from "@shared/thread-workflow"
import { historyShellStore } from "@/lib/history-shell-store"

interface WorkflowControllerState {
  error: string | null
  isSaving: boolean
  projectionError: string | null
  refreshError: string | null
  threadId: string
  view: ThreadWorkflowView
}

export interface LauncherAiWorkflowController {
  addLabel: (input: { labelId: string; rawValue: string }) => Promise<boolean>
  clearError: () => void
  createLabel: (input: Omit<CreateProjectWorkflowLabelInput, "projectId">) => Promise<boolean>
  createStatus: (input: Omit<CreateProjectWorkflowStatusInput, "projectId">) => Promise<boolean>
  error: string | null
  isSaving: boolean
  projectionError: string | null
  refreshError: string | null
  removeLabel: (input: { labelId: string; rawValue: string }) => Promise<boolean>
  setDefaultStatus: (projectId: string, statusId: string) => Promise<boolean>
  setStatus: (statusId: string) => Promise<boolean>
  snapshot: ThreadWorkflowView | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const EMPTY_VIEW: ThreadWorkflowView = { project: null, summary: null }

export function useLauncherAiWorkflowController(threadId: string): LauncherAiWorkflowController {
  const [state, setState] = useState<WorkflowControllerState | null>(null)
  const lifecycleEpochRef = useRef(0)
  const mutationInFlightRef = useRef(false)
  const pendingEventRefreshRef = useRef(false)
  const projectionRequestEpochRef = useRef(0)
  const requestEpochRef = useRef(0)

  const isCurrentLifecycle = useCallback((lifecycleEpoch: number): boolean => {
    return lifecycleEpochRef.current === lifecycleEpoch
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const lifecycleEpoch = lifecycleEpochRef.current
    const requestEpoch = ++requestEpochRef.current
    try {
      const view = await window.api.threadWorkflow.get(threadId)
      if (!isCurrentLifecycle(lifecycleEpoch) || requestEpochRef.current !== requestEpoch) {
        return
      }
      setState((current) => ({
        error: null,
        isSaving: current?.threadId === threadId ? current.isSaving : false,
        projectionError: current?.threadId === threadId ? current.projectionError : null,
        refreshError: null,
        threadId,
        view
      }))
    } catch (error) {
      if (!isCurrentLifecycle(lifecycleEpoch) || requestEpochRef.current !== requestEpoch) {
        return
      }
      setState((current) => ({
        error: current?.threadId === threadId ? current.error : null,
        isSaving: current?.threadId === threadId ? current.isSaving : false,
        projectionError: current?.threadId === threadId ? current.projectionError : null,
        refreshError: toErrorMessage(error),
        threadId,
        view: current?.threadId === threadId ? current.view : EMPTY_VIEW
      }))
    }
  }, [isCurrentLifecycle, threadId])

  useEffect(() => {
    const lifecycleEpoch = ++lifecycleEpochRef.current
    const requestEpoch = ++requestEpochRef.current
    void window.api.threadWorkflow.get(threadId).then(
      (view) => {
        if (isCurrentLifecycle(lifecycleEpoch) && requestEpochRef.current === requestEpoch) {
          setState({
            error: null,
            isSaving: false,
            projectionError: null,
            refreshError: null,
            threadId,
            view
          })
        }
      },
      (error: unknown) => {
        if (isCurrentLifecycle(lifecycleEpoch) && requestEpochRef.current === requestEpoch) {
          setState({
            error: toErrorMessage(error),
            isSaving: false,
            projectionError: null,
            refreshError: null,
            threadId,
            view: EMPTY_VIEW
          })
        }
      }
    )

    return () => {
      if (isCurrentLifecycle(lifecycleEpoch)) {
        lifecycleEpochRef.current += 1
        projectionRequestEpochRef.current += 1
        requestEpochRef.current += 1
      }
    }
  }, [isCurrentLifecycle, threadId])

  const refreshSidebarProjection = useCallback(async (): Promise<void> => {
    const lifecycleEpoch = lifecycleEpochRef.current
    const requestEpoch = ++projectionRequestEpochRef.current
    try {
      await historyShellStore.getState().loadSidebarView()
      if (
        !isCurrentLifecycle(lifecycleEpoch) ||
        projectionRequestEpochRef.current !== requestEpoch
      ) {
        return
      }
      setState((current) =>
        current?.threadId === threadId ? { ...current, projectionError: null } : current
      )
    } catch (error) {
      if (
        !isCurrentLifecycle(lifecycleEpoch) ||
        projectionRequestEpochRef.current !== requestEpoch
      ) {
        return
      }
      setState((current) =>
        current?.threadId === threadId
          ? { ...current, projectionError: toErrorMessage(error) }
          : current
      )
    }
  }, [isCurrentLifecycle, threadId])

  useEffect(
    () =>
      window.api.threadWorkflow.onChanged((event) => {
        if (event.scope === "thread" && event.threadId !== threadId) {
          return
        }
        if (mutationInFlightRef.current) {
          pendingEventRefreshRef.current = true
          return
        }
        void refresh()
        void refreshSidebarProjection()
      }),
    [refresh, refreshSidebarProjection, threadId]
  )

  const runMutation = useCallback(
    async <T>(
      mutation: () => Promise<T>,
      projectResult: (currentView: ThreadWorkflowView, result: T) => ThreadWorkflowView
    ): Promise<boolean> => {
      if (mutationInFlightRef.current) {
        return false
      }
      const lifecycleEpoch = lifecycleEpochRef.current
      const requestEpoch = ++requestEpochRef.current
      mutationInFlightRef.current = true
      setState((current) => ({
        error: null,
        isSaving: true,
        projectionError: null,
        refreshError: null,
        threadId,
        view: current?.threadId === threadId ? current.view : EMPTY_VIEW
      }))
      try {
        const result = await mutation()
        if (isCurrentLifecycle(lifecycleEpoch)) {
          setState((current) => {
            const currentView = current?.threadId === threadId ? current.view : EMPTY_VIEW
            return {
              error: null,
              isSaving: false,
              projectionError: current?.threadId === threadId ? current.projectionError : null,
              refreshError: current?.threadId === threadId ? current.refreshError : null,
              threadId,
              view:
                requestEpochRef.current === requestEpoch
                  ? projectResult(currentView, result)
                  : currentView
            }
          })
          void refreshSidebarProjection()
        }
        return true
      } catch (error) {
        if (isCurrentLifecycle(lifecycleEpoch)) {
          setState((current) => ({
            error: toErrorMessage(error),
            isSaving: false,
            projectionError: current?.threadId === threadId ? current.projectionError : null,
            refreshError: current?.threadId === threadId ? current.refreshError : null,
            threadId,
            view: current?.threadId === threadId ? current.view : EMPTY_VIEW
          }))
        }
        return false
      } finally {
        mutationInFlightRef.current = false
        if (pendingEventRefreshRef.current) {
          pendingEventRefreshRef.current = false
          if (isCurrentLifecycle(lifecycleEpoch)) {
            void refresh()
            void refreshSidebarProjection()
          }
        }
      }
    },
    [isCurrentLifecycle, refresh, refreshSidebarProjection, threadId]
  )

  const runThreadMutation = useCallback(
    (mutation: () => Promise<ThreadWorkflowView>): Promise<boolean> =>
      runMutation(mutation, (_currentView, view) => view),
    [runMutation]
  )

  const runProjectMutation = useCallback(
    (mutation: () => Promise<ProjectWorkflowDefinition>): Promise<boolean> =>
      runMutation(mutation, (currentView, project) =>
        currentView.project?.projectId === project.projectId
          ? { ...currentView, project }
          : currentView
      ),
    [runMutation]
  )

  const snapshot = state?.threadId === threadId ? state.view : null
  const projectId = snapshot?.project?.projectId

  const addLabel = useCallback(
    (input: { labelId: string; rawValue: string }): Promise<boolean> =>
      runThreadMutation(() => window.api.threadWorkflow.addLabel({ ...input, threadId })),
    [runThreadMutation, threadId]
  )
  const removeLabel = useCallback(
    (input: { labelId: string; rawValue: string }): Promise<boolean> =>
      runThreadMutation(() => window.api.threadWorkflow.removeLabel({ ...input, threadId })),
    [runThreadMutation, threadId]
  )
  const setStatus = useCallback(
    (statusId: string): Promise<boolean> =>
      runThreadMutation(() => window.api.threadWorkflow.setStatus({ statusId, threadId })),
    [runThreadMutation, threadId]
  )
  const clearError = useCallback((): void => {
    setState((current) =>
      current?.threadId === threadId
        ? { ...current, error: null, projectionError: null, refreshError: null }
        : current
    )
  }, [threadId])
  const createStatus = useCallback(
    (input: Omit<CreateProjectWorkflowStatusInput, "projectId">): Promise<boolean> => {
      if (!projectId) {
        return Promise.resolve(false)
      }
      return runProjectMutation(() =>
        window.api.threadWorkflow.createStatus({ ...input, projectId })
      )
    },
    [projectId, runProjectMutation]
  )
  const setDefaultStatus = useCallback(
    (ownerProjectId: string, statusId: string): Promise<boolean> =>
      runProjectMutation(() =>
        window.api.threadWorkflow.setDefaultStatus({ projectId: ownerProjectId, statusId })
      ),
    [runProjectMutation]
  )
  const createLabel = useCallback(
    (input: Omit<CreateProjectWorkflowLabelInput, "projectId">): Promise<boolean> => {
      if (!projectId) {
        return Promise.resolve(false)
      }
      return runProjectMutation(() =>
        window.api.threadWorkflow.createLabel({ ...input, projectId })
      )
    },
    [projectId, runProjectMutation]
  )

  return {
    addLabel,
    clearError,
    createLabel,
    createStatus,
    error: state?.threadId === threadId ? state.error : null,
    isSaving: state?.threadId === threadId ? state.isSaving : false,
    projectionError: state?.threadId === threadId ? state.projectionError : null,
    refreshError: state?.threadId === threadId ? state.refreshError : null,
    removeLabel,
    setDefaultStatus,
    setStatus,
    snapshot
  }
}
