import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import type { ArtifactRecord } from "@shared/artifacts"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import type { ActiveAgentRun, AgentThreadEvent } from "@shared/agent-thread-runtime"
import {
  getArtifactTabId,
  getNextActiveTabAfterClose,
  type OpenArtifactTab,
  type OpenFile
} from "@shared/thread-tabs"
import type { HITLRequest, Message, Subagent, ThreadForkState, Todo } from "../types"
import {
  createDefaultMessagesProjection,
  projectToolExecutionsView,
  type AgentToolExecutionsView,
  type MessagesProjection
} from "./message-projection"
import {
  applyRuntimeEventsToThreadState,
  createRuntimeThreadStateUpdate
} from "./agent-runtime-reducer"
import { applyRuntimeSnapshotToThreadState } from "./agent-runtime-snapshot-reducer"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type {
  AgentToolExecutionView,
  AgentToolExecutionViewStatus,
  AgentToolExecutionsView
} from "./message-projection"

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  lastUpdated: Date
}

export interface AgentSourceState {
  activeRun: ActiveAgentRun | null
  artifacts: ArtifactRecord[]
  forkState: ThreadForkState
  messages: Message[]
  title: string | null
  todos: Todo[]
  workspacePath: string | null
  subagents: Subagent[]
  pendingApproval: HITLRequest | null
  error: string | null
  currentModel: string
  permissionMode: PermissionModeName
  revision: number
  runId: string | null
  tokenUsage: TokenUsage | null
}

export interface AgentViewState {
  messageProjection: MessagesProjection
  toolExecutions: AgentToolExecutionsView
}

export interface ThreadLocalUiState {
  openFiles: OpenFile[]
  openArtifacts: OpenArtifactTab[]
  activeTab: "agent" | string
  fileContents: Record<string, string>
}

export interface ThreadState {
  agent: AgentSourceState
  view: AgentViewState
  ui: ThreadLocalUiState
}

export type ThreadStateUpdate = {
  agent?: Partial<AgentSourceState>
  view?: Partial<AgentViewState>
  ui?: Partial<ThreadLocalUiState>
}

function projectAgentToolExecutionsView(
  agent: AgentSourceState,
  messageProjection: MessagesProjection,
  previous: AgentToolExecutionsView
): AgentToolExecutionsView {
  return projectToolExecutionsView({
    activeRun: agent.activeRun,
    messageProjection,
    pendingApproval: agent.pendingApproval,
    previous
  })
}

export interface ThreadActions {
  setWorkspacePath: (path: string | null) => void
  setError: (error: string | null) => void
  clearError: () => void
  setCurrentModel: (modelId: string) => void
  setPermissionMode: (permissionMode: PermissionModeName) => void
  openFile: (path: string, name: string) => void
  closeFile: (path: string) => void
  openArtifactTab: (tab: OpenArtifactTab) => void
  closeArtifactTab: (artifactId: string) => void
  setActiveTab: (tab: "agent" | string) => void
  setFileContents: (path: string, content: string) => void
}

export interface ThreadStoreEffects {
  persistCurrentModel?: (threadId: string, modelId: string) => void | Promise<void>
  persistPermissionMode?: (
    threadId: string,
    permissionMode: PermissionModeName
  ) => void | Promise<void>
}

export interface ThreadStore {
  applyArtifactsChanged: (threadId: string, artifacts: ArtifactRecord[]) => void
  applyRuntimeEvents: (threadId: string, events: AgentThreadEvent[]) => void
  applyThreadDataSnapshot: (threadId: string, snapshot: AgentThreadDataSnapshot) => void
  deleteThreadState: (threadId: string) => void
  ensureThreadState: (threadId: string) => boolean
  getAllThreadStates: () => Record<string, ThreadState>
  getThreadActions: (threadId: string) => ThreadActions
  getThreadState: (threadId: string) => ThreadState | null
  subscribeAllThreadStates: (listener: () => void) => () => void
  subscribeThread: (threadId: string, listener: () => void) => () => void
}

export function createDefaultThreadState(): ThreadState {
  return {
    agent: {
      activeRun: null,
      artifacts: [],
      forkState: {
        canFork: true
      },
      messages: [],
      title: null,
      todos: [],
      workspacePath: null,
      subagents: [],
      pendingApproval: null,
      error: null,
      currentModel: DEFAULT_MODELS.llm,
      permissionMode: DEFAULT_PERMISSION_MODE,
      revision: 0,
      runId: null,
      tokenUsage: null
    },
    view: {
      messageProjection: createDefaultMessagesProjection(),
      toolExecutions: {}
    },
    ui: {
      openFiles: [],
      openArtifacts: [],
      activeTab: "agent",
      fileContents: {}
    }
  }
}

export function createThreadStore(effects: ThreadStoreEffects = {}): ThreadStore {
  const threadListeners = new Map<string, Set<() => void>>()
  const allThreadStateListeners = new Set<() => void>()
  const actionsCache: Record<string, ThreadActions> = {}
  let threadStates: Record<string, ThreadState> = {}

  const getThreadState = (threadId: string): ThreadState | null => {
    return threadStates[threadId] ?? null
  }

  const emitThread = (threadId: string): void => {
    threadListeners.get(threadId)?.forEach((listener) => listener())
    allThreadStateListeners.forEach((listener) => listener())
  }

  const hasThreadStateChanges = (nextPartial: ThreadStateUpdate): boolean =>
    Boolean(
      (nextPartial.agent && Object.keys(nextPartial.agent).length > 0) ||
      (nextPartial.view && Object.keys(nextPartial.view).length > 0) ||
      (nextPartial.ui && Object.keys(nextPartial.ui).length > 0)
    )

  const filterLayerChanges = <T extends object>(
    current: T,
    nextPartial: Partial<T> | undefined
  ): Partial<T> | undefined => {
    if (!nextPartial) {
      return undefined
    }

    const changedEntries = Object.entries(nextPartial).filter(([key, value]) => {
      return !Object.is(current[key as keyof T], value)
    })

    return changedEntries.length > 0
      ? (Object.fromEntries(changedEntries) as Partial<T>)
      : undefined
  }

  const filterThreadStateChanges = (
    current: ThreadState,
    nextPartial: ThreadStateUpdate
  ): ThreadStateUpdate => ({
    agent: filterLayerChanges(current.agent, nextPartial.agent),
    view: filterLayerChanges(current.view, nextPartial.view),
    ui: filterLayerChanges(current.ui, nextPartial.ui)
  })

  const updateThreadState = (
    threadId: string,
    updater: (prev: ThreadState) => ThreadStateUpdate
  ): void => {
    const current = threadStates[threadId] ?? createDefaultThreadState()
    const requestedPartial = updater(current)
    const requestedView = requestedPartial.view
    const nextAgent = requestedPartial.agent
      ? { ...current.agent, ...requestedPartial.agent }
      : current.agent
    const projectedToolExecutions = projectAgentToolExecutionsView(
      nextAgent,
      requestedView?.messageProjection ?? current.view.messageProjection,
      current.view.toolExecutions
    )
    const nextPartial = filterThreadStateChanges(current, {
      ...requestedPartial,
      view: {
        ...requestedView,
        toolExecutions: projectedToolExecutions
      }
    })

    if (!hasThreadStateChanges(nextPartial)) {
      return
    }

    threadStates = {
      ...threadStates,
      [threadId]: {
        ...current,
        agent: nextPartial.agent ? { ...current.agent, ...nextPartial.agent } : current.agent,
        view: nextPartial.view ? { ...current.view, ...nextPartial.view } : current.view,
        ui: nextPartial.ui ? { ...current.ui, ...nextPartial.ui } : current.ui
      }
    }
    emitThread(threadId)
  }

  const applyThreadDataSnapshot = (threadId: string, snapshot: AgentThreadDataSnapshot): void => {
    updateThreadState(threadId, (state) => {
      const nextState = applyRuntimeSnapshotToThreadState(state, snapshot)
      return {
        agent: nextState.agent,
        view: nextState.view
      }
    })
  }

  const applyRuntimeEvents = (threadId: string, events: AgentThreadEvent[]): void => {
    if (events.length === 0) {
      return
    }

    updateThreadState(threadId, (state) => {
      const nextState = applyRuntimeEventsToThreadState(state, events, { threadId })
      return createRuntimeThreadStateUpdate(nextState)
    })
  }

  const applyArtifactsChanged = (threadId: string, artifacts: ArtifactRecord[]): void => {
    updateThreadState(threadId, () => ({
      agent: { artifacts }
    }))
  }

  const getThreadActions = (threadId: string): ThreadActions => {
    if (actionsCache[threadId]) {
      return actionsCache[threadId]
    }

    const actions: ThreadActions = {
      setWorkspacePath: (path: string | null) => {
        updateThreadState(threadId, () => ({ agent: { workspacePath: path } }))
      },
      setError: (error: string | null) => {
        updateThreadState(threadId, () => ({ agent: { error } }))
      },
      clearError: () => {
        updateThreadState(threadId, () => ({ agent: { error: null } }))
      },
      setCurrentModel: (modelId: string) => {
        updateThreadState(threadId, () => ({ agent: { currentModel: modelId } }))
        void effects.persistCurrentModel?.(threadId, modelId)
      },
      setPermissionMode: (permissionMode: PermissionModeName) => {
        updateThreadState(threadId, () => ({ agent: { permissionMode } }))
        void effects.persistPermissionMode?.(threadId, permissionMode)
      },
      openFile: (path: string, name: string) => {
        updateThreadState(threadId, (state) => {
          if (state.ui.openFiles.some((file) => file.path === path)) {
            return {
              ui: { activeTab: path }
            }
          }

          return {
            ui: {
              openFiles: [...state.ui.openFiles, { path, name }],
              activeTab: path
            }
          }
        })
      },
      closeFile: (path: string) => {
        updateThreadState(threadId, (state) => {
          const nextOpenFiles = state.ui.openFiles.filter((file) => file.path !== path)
          const nextFileContents = { ...state.ui.fileContents }
          delete nextFileContents[path]

          return {
            ui: {
              activeTab: getNextActiveTabAfterClose({
                activeTab: state.ui.activeTab,
                closedTabId: path,
                openArtifacts: state.ui.openArtifacts,
                openFiles: state.ui.openFiles
              }),
              fileContents: nextFileContents,
              openFiles: nextOpenFiles
            }
          }
        })
      },
      openArtifactTab: (tab: OpenArtifactTab) => {
        updateThreadState(threadId, (state) => {
          const nextTabId = getArtifactTabId(tab.artifactId)
          const existingTabIndex = state.ui.openArtifacts.findIndex(
            (entry) => entry.artifactId === tab.artifactId
          )

          if (existingTabIndex >= 0) {
            const nextOpenArtifacts = [...state.ui.openArtifacts]
            nextOpenArtifacts[existingTabIndex] = tab

            return {
              ui: {
                activeTab: nextTabId,
                openArtifacts: nextOpenArtifacts
              }
            }
          }

          return {
            ui: {
              activeTab: nextTabId,
              openArtifacts: [...state.ui.openArtifacts, tab]
            }
          }
        })
      },
      closeArtifactTab: (artifactId: string) => {
        updateThreadState(threadId, (state) => ({
          ui: {
            activeTab: getNextActiveTabAfterClose({
              activeTab: state.ui.activeTab,
              closedTabId: getArtifactTabId(artifactId),
              openArtifacts: state.ui.openArtifacts,
              openFiles: state.ui.openFiles
            }),
            openArtifacts: state.ui.openArtifacts.filter((entry) => entry.artifactId !== artifactId)
          }
        }))
      },
      setActiveTab: (tab: "agent" | string) => {
        updateThreadState(threadId, () => ({ ui: { activeTab: tab } }))
      },
      setFileContents: (path: string, content: string) => {
        updateThreadState(threadId, (state) => ({
          ui: {
            fileContents: {
              ...state.ui.fileContents,
              [path]: content
            }
          }
        }))
      }
    }

    actionsCache[threadId] = actions
    return actions
  }

  const ensureThreadState = (threadId: string): boolean => {
    if (threadStates[threadId]) {
      return false
    }

    threadStates = {
      ...threadStates,
      [threadId]: createDefaultThreadState()
    }
    emitThread(threadId)
    return true
  }

  const deleteThreadState = (threadId: string): void => {
    const hadThreadState = Object.hasOwn(threadStates, threadId)

    if (!hadThreadState) {
      delete actionsCache[threadId]
      return
    }

    if (hadThreadState) {
      const { [threadId]: _deletedThreadState, ...restThreadStates } = threadStates
      void _deletedThreadState
      threadStates = restThreadStates
      delete actionsCache[threadId]
      threadListeners.get(threadId)?.forEach((listener) => listener())
      allThreadStateListeners.forEach((listener) => listener())
    }
  }

  return {
    applyArtifactsChanged,
    applyRuntimeEvents,
    applyThreadDataSnapshot,
    deleteThreadState,
    ensureThreadState,
    getAllThreadStates: () => threadStates,
    getThreadActions,
    getThreadState,
    subscribeAllThreadStates: (listener: () => void): (() => void) => {
      allThreadStateListeners.add(listener)
      return () => {
        allThreadStateListeners.delete(listener)
      }
    },
    subscribeThread: (threadId: string, listener: () => void): (() => void) => {
      let listeners = threadListeners.get(threadId)
      if (!listeners) {
        listeners = new Set()
        threadListeners.set(threadId, listeners)
      }

      listeners.add(listener)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          threadListeners.delete(threadId)
        }
      }
    }
  }
}
