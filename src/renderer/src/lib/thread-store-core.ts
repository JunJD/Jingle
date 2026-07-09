import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import type { ArtifactRecord } from "@shared/artifacts"
import type {
  AgentThreadDataSnapshot
} from "@shared/app-types"
import {
  createJingleThreadStateStore,
  type JingleAgentFollowUpQueueItem,
  type JingleAgentSteerResult,
  type JingleTokenUsage
} from "@jingle/agent-client"
import type { ComposerMessageInput } from "@shared/message-content"
import {
  getArtifactTabId,
  getFileTabId,
  getNextActiveTabAfterClose,
  type OpenArtifactTab,
  type OpenFile
} from "@shared/thread-tabs"
import type { ThreadForkState } from "../types"
import { createDefaultMessagesProjection, type MessagesProjection } from "./message-projection"
import {
  createDefaultAgentThreadRuntimeState,
  type AgentThreadEvent,
  type AgentThreadRuntimeState
} from "@shared/agent-thread-contract"
import {
  createRuntimeEventProjectionUpdate,
  applyRuntimeEventsToThreadState
} from "./agent-runtime-event-projector"
import { applyRuntimeSnapshotToThreadState } from "./agent-runtime-snapshot-reducer"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type { AgentThreadEvent, AgentThreadRuntimeState } from "@shared/agent-thread-contract"
export type TokenUsage = JingleTokenUsage

export interface AgentSourceState extends AgentThreadRuntimeState {
  artifacts: ArtifactRecord[]
  forkState: ThreadForkState
  workspacePath: string | null
  currentModel: string
  permissionMode: PermissionModeName
}

interface AgentViewState {
  messageProjection: MessagesProjection
}

interface ThreadLocalUiState {
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

type ThreadStateUpdate = {
  agent?: Partial<AgentSourceState>
  view?: Partial<AgentViewState>
  ui?: Partial<ThreadLocalUiState>
}

export interface ThreadLocalUiControl {
  openFile: (path: string, name: string) => void
  closeFile: (path: string) => void
  openArtifactTab: (tab: OpenArtifactTab) => void
  closeArtifactTab: (artifactId: string) => void
  setActiveTab: (tab: "agent" | string) => void
  setFileContents: (path: string, content: string) => void
}

export interface ThreadAgentControl {
  enqueueFollowUp: (messageInput: ComposerMessageInput) => Promise<JingleAgentFollowUpQueueItem>
  removeFollowUp: (requestId: string) => Promise<void>
  restoreFollowUp: (item: JingleAgentFollowUpQueueItem) => Promise<void>
  steerFollowUp: (
    requestId: string,
    expected?: { runId?: string | null; turnId?: string | null }
  ) => Promise<JingleAgentSteerResult>
  takeFollowUp: (requestId: string) => Promise<JingleAgentFollowUpQueueItem | null>
}

export interface ThreadControl {
  agent: ThreadAgentControl
  local: ThreadLocalUiControl
}

export interface ThreadStore {
  applyArtifactsChanged: (threadId: string, artifacts: ArtifactRecord[]) => void
  applyRuntimeEvents: (threadId: string, events: AgentThreadEvent[]) => void
  applyThreadDataSnapshot: (threadId: string, snapshot: AgentThreadDataSnapshot) => void
  deleteThreadState: (threadId: string) => void
  ensureThreadState: (threadId: string) => boolean
  getThreadControl: (threadId: string) => ThreadControl
  getThreadState: (threadId: string) => ThreadState | null
  subscribeThread: (threadId: string, listener: () => void) => () => void
}

export function createDefaultThreadState(threadId = ""): ThreadState {
  return {
    agent: {
      ...createDefaultAgentThreadRuntimeState(threadId),
      artifacts: [],
      forkState: {
        canFork: true
      },
      workspacePath: null,
      currentModel: DEFAULT_MODELS.llm,
      permissionMode: DEFAULT_PERMISSION_MODE
    },
    view: {
      messageProjection: createDefaultMessagesProjection()
    },
    ui: {
      openFiles: [],
      openArtifacts: [],
      activeTab: "agent",
      fileContents: {}
    }
  }
}

export function createThreadStore(): ThreadStore {
  const controlCache: Record<string, ThreadControl> = {}
  const stateStore = createJingleThreadStateStore<ThreadState>({
    createState: createDefaultThreadState
  })

  const getThreadState = (threadId: string): ThreadState | null => {
    return stateStore.getThreadState(threadId)
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
    stateStore.updateThreadState(threadId, (current) => {
      const requestedPartial = updater(current)
      const nextPartial = filterThreadStateChanges(current, requestedPartial)

      if (!hasThreadStateChanges(nextPartial)) {
        return current
      }

      return {
        ...current,
        agent: nextPartial.agent ? { ...current.agent, ...nextPartial.agent } : current.agent,
        view: nextPartial.view ? { ...current.view, ...nextPartial.view } : current.view,
        ui: nextPartial.ui ? { ...current.ui, ...nextPartial.ui } : current.ui
      }
    })
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
      return createRuntimeEventProjectionUpdate(nextState)
    })
  }

  const applyArtifactsChanged = (threadId: string, artifacts: ArtifactRecord[]): void => {
    updateThreadState(threadId, () => ({
      agent: { artifacts }
    }))
  }

  const getThreadControl = (threadId: string): ThreadControl => {
    if (controlCache[threadId]) {
      return controlCache[threadId]
    }

    const local: ThreadLocalUiControl = {
      openFile: (path: string, name: string) => {
        updateThreadState(threadId, (state) => {
          const nextTabId = getFileTabId(path)
          if (state.ui.openFiles.some((file) => file.path === path)) {
            return {
              ui: { activeTab: nextTabId }
            }
          }

          return {
            ui: {
              openFiles: [...state.ui.openFiles, { path, name }],
              activeTab: nextTabId
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
                closedTabId: getFileTabId(path),
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

    const agent: ThreadAgentControl = {
      enqueueFollowUp: (messageInput) => {
        return window.api.agent.enqueueFollowUp(threadId, messageInput)
      },
      removeFollowUp: (requestId) => {
        return window.api.agent.removeFollowUp(threadId, requestId)
      },
      restoreFollowUp: (item) => {
        return window.api.agent.restoreFollowUp(threadId, item)
      },
      steerFollowUp: (requestId, expected) => {
        return window.api.agent.steerFollowUp(
          threadId,
          requestId,
          expected?.runId,
          expected?.turnId
        )
      },
      takeFollowUp: (requestId) => {
        return window.api.agent.takeFollowUp(threadId, requestId)
      }
    }

    const control: ThreadControl = { agent, local }
    controlCache[threadId] = control
    return control
  }

  const ensureThreadState = (threadId: string): boolean => {
    return stateStore.ensureThreadState(threadId)
  }

  const deleteThreadState = (threadId: string): void => {
    stateStore.deleteThreadState(threadId)
    delete controlCache[threadId]
  }

  return {
    applyArtifactsChanged,
    applyRuntimeEvents,
    applyThreadDataSnapshot,
    deleteThreadState,
    ensureThreadState,
    getThreadControl,
    getThreadState,
    subscribeThread: stateStore.subscribeThread
  }
}
