import { useCallback, useEffect, useState } from "react"
import type { ExtensionRunBotAgentPayload } from "@shared/extension-runtime-protocol"
import type { ProjectWorkflowDefinition, ThreadWorkflowCreateInput } from "@shared/thread-workflow"
import { useI18n } from "@/lib/i18n"
import {
  runBotAgentConfirmationCommands,
  type RunBotAgentConfirmationCommands
} from "./run-bot-agent-commands"
import {
  RunBotAgentConfirmationLifecycle,
  type RunBotAgentConfirmationRequest
} from "./run-bot-agent-confirmation-lifecycle"
import {
  createConfirmedRunBotAgentWorkflow,
  resolveRunBotAgentConfirmation
} from "./run-bot-agent-confirmation-model"
import { projectRunBotAgentSource } from "./run-bot-agent-projection"

export interface ConfirmedRunBotAgentLaunch {
  workflow: ThreadWorkflowCreateInput
  workspacePath: string
}

interface ConfirmationState {
  error: string | null
  input: ExtensionRunBotAgentPayload
  isAddingProject: boolean
  isLoadingProjects: boolean
  projects: ProjectWorkflowDefinition[]
  request: RunBotAgentConfirmationRequest<ConfirmedRunBotAgentLaunch>
  selectedProjectId: string | null
}

export interface RunBotAgentProjectView {
  displayName: string
  projectId: string
  selected: boolean
  workspacePath: string
}

export interface RunBotAgentLabelView {
  id: string
  text: string
}

export interface RunBotAgentSourceView {
  label: string
  title: string
}

export interface RunBotAgentConfirmationProjection {
  canConfirm: boolean
  error: string | null
  isAddingProject: boolean
  isLoadingProjects: boolean
  labels: RunBotAgentLabelView[]
  projects: RunBotAgentProjectView[]
  source: RunBotAgentSourceView | null
  statusLabel: string
  title: string
  validationErrors: string[]
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function projectSource(
  source: ExtensionRunBotAgentPayload["sourceRef"]
): RunBotAgentSourceView | null {
  if (!source) {
    return null
  }

  const projection = projectRunBotAgentSource(source)
  return { label: projection.label, title: projection.title }
}

export function useRunBotAgentConfirmationController(
  commands: RunBotAgentConfirmationCommands = runBotAgentConfirmationCommands
): {
  addProject: () => Promise<void>
  cancelConfirmation: () => void
  confirmRunBotAgent: (
    input: ExtensionRunBotAgentPayload,
    context: { signal: AbortSignal }
  ) => Promise<ConfirmedRunBotAgentLaunch>
  confirmSelection: () => void
  projection: RunBotAgentConfirmationProjection | null
  selectProject: (projectId: string) => void
} {
  const { copy } = useI18n()
  const [lifecycle] = useState(
    () => new RunBotAgentConfirmationLifecycle<ConfirmedRunBotAgentLaunch>()
  )
  const [state, setState] = useState<ConfirmationState | null>(null)

  const cancelConfirmation = useCallback((): void => {
    if (lifecycle.cancelCurrent(new Error(copy.runBotAgent.cancelledError))) {
      setState(null)
    }
  }, [copy.runBotAgent.cancelledError, lifecycle])

  useEffect(() => {
    return () => {
      lifecycle.dispose(new Error(copy.runBotAgent.cancelledError))
    }
  }, [copy.runBotAgent.cancelledError, lifecycle])

  const confirmRunBotAgent = useCallback(
    (
      input: ExtensionRunBotAgentPayload,
      context: { signal: AbortSignal }
    ): Promise<ConfirmedRunBotAgentLaunch> => {
      let request: RunBotAgentConfirmationRequest<ConfirmedRunBotAgentLaunch>
      try {
        request = lifecycle.begin({
          concurrentError: copy.runBotAgent.concurrentError,
          onAbort: () => {
            setState((current) => (current?.request === request ? null : current))
          },
          signal: context.signal
        })
      } catch (error) {
        return Promise.reject(error)
      }

      setState({
        error: null,
        input,
        isAddingProject: false,
        isLoadingProjects: true,
        projects: [],
        request,
        selectedProjectId: null
      })

      void commands.listProjects().then(
        (projects) => {
          if (!lifecycle.isCurrent(request)) {
            return
          }
          setState((current) =>
            current?.request === request
              ? {
                  ...current,
                  isLoadingProjects: false,
                  projects
                }
              : current
          )
        },
        (error: unknown) => {
          if (!lifecycle.isCurrent(request)) {
            return
          }
          setState((current) =>
            current?.request === request
              ? {
                  ...current,
                  error: getErrorMessage(error),
                  isLoadingProjects: false
                }
              : current
          )
        }
      )

      return request.promise
    },
    [commands, copy.runBotAgent.concurrentError, lifecycle]
  )

  const addProject = useCallback(async (): Promise<void> => {
    if (!state || !lifecycle.isCurrent(state.request)) {
      return
    }
    const request = state.request
    setState((current) =>
      current?.request === request
        ? {
            ...current,
            error: null,
            isAddingProject: true
          }
        : current
    )

    try {
      const workspacePath = await commands.selectProjectFolder()
      if (!workspacePath || !lifecycle.isCurrent(request)) {
        return
      }
      const addedProject = await commands.addProject(workspacePath)
      const projects = await commands.listProjects()
      if (!lifecycle.isCurrent(request)) {
        return
      }
      setState((current) =>
        current?.request === request
          ? {
              ...current,
              projects,
              selectedProjectId: addedProject.projectId
            }
          : current
      )
    } catch (error) {
      if (lifecycle.isCurrent(request)) {
        setState((current) =>
          current?.request === request
            ? {
                ...current,
                error: getErrorMessage(error)
              }
            : current
        )
      }
    } finally {
      if (lifecycle.isCurrent(request)) {
        setState((current) =>
          current?.request === request
            ? {
                ...current,
                isAddingProject: false
              }
            : current
        )
      }
    }
  }, [commands, lifecycle, state])

  const selectProject = useCallback((projectId: string): void => {
    setState((current) => {
      if (!current?.projects.some((project) => project.projectId === projectId)) {
        return current
      }
      return {
        ...current,
        error: null,
        selectedProjectId: projectId
      }
    })
  }, [])

  const confirmSelection = useCallback((): void => {
    if (!state || !lifecycle.isCurrent(state.request)) {
      return
    }
    const selectedProject =
      state.projects.find((project) => project.projectId === state.selectedProjectId) ?? null
    const resolution = resolveRunBotAgentConfirmation(state.input, selectedProject)
    const workflow = createConfirmedRunBotAgentWorkflow(state.input, resolution)
    if (!workflow || state.isAddingProject || state.isLoadingProjects) {
      return
    }

    if (
      lifecycle.resolve(state.request, {
        workflow,
        workspacePath: resolution.selectedProject!.workspacePath
      })
    ) {
      setState(null)
    }
  }, [lifecycle, state])

  let projection: RunBotAgentConfirmationProjection | null = null
  if (state) {
    const selectedProject =
      state.projects.find((project) => project.projectId === state.selectedProjectId) ?? null
    const resolved = resolveRunBotAgentConfirmation(state.input, selectedProject)
    const workflow = createConfirmedRunBotAgentWorkflow(state.input, resolved)
    const validationErrors: string[] = []
    if (resolved.missingStatus && resolved.resolvedStatusKey) {
      validationErrors.push(copy.runBotAgent.missingStatus(resolved.resolvedStatusKey))
    }
    if (resolved.missingLabelKeys.length > 0) {
      validationErrors.push(copy.runBotAgent.missingLabels(resolved.missingLabelKeys.join(", ")))
    }
    if (resolved.invalidLabelTypeKeys.length > 0) {
      validationErrors.push(
        copy.runBotAgent.invalidLabelTypes(resolved.invalidLabelTypeKeys.join(", "))
      )
    }

    projection = {
      canConfirm: Boolean(workflow && !state.isAddingProject && !state.isLoadingProjects),
      error: state.error,
      isAddingProject: state.isAddingProject,
      isLoadingProjects: state.isLoadingProjects,
      labels: resolved.requestedLabels.map((label, index) => ({
        id: `${label.key}:${label.value ?? ""}:${index}`,
        text: label.value === undefined ? label.key : `${label.key}: ${label.value}`
      })),
      projects: state.projects.map((project) => ({
        displayName: project.displayName,
        projectId: project.projectId,
        selected: project.projectId === state.selectedProjectId,
        workspacePath: project.workspacePath
      })),
      source: projectSource(state.input.sourceRef),
      statusLabel: resolved.resolvedStatusKey ?? copy.runBotAgent.defaultStatus,
      title: state.input.title,
      validationErrors
    }
  }

  return {
    addProject,
    cancelConfirmation,
    confirmRunBotAgent,
    confirmSelection,
    projection,
    selectProject
  }
}
