import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import type { ArtifactRecord } from "@shared/artifacts"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import type { ActiveAgentRun, AgentThreadEvent } from "@shared/agent-thread-runtime"
import {
  getArtifactTabId,
  getNextActiveTabAfterClose,
  syncOpenArtifactTabs,
  type OpenArtifactTab,
  type OpenFile
} from "@shared/thread-tabs"
import type { HITLRequest, Message, Subagent, ThreadForkState, Todo } from "../types"
import {
  createDefaultMessagesProjection,
  projectMessages,
  type MessagesProjection
} from "./message-projection"
import {
  applyRuntimeEventsToThreadState,
  createRuntimeThreadStateUpdate
} from "./thread-runtime-adapter"
import { applyThreadDataSnapshotToThreadState } from "./thread-data-adapter"
import { stabilizeThreadMessages } from "./thread-message-stability"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  lastUpdated: Date
}

export interface ThreadState {
  activeRun: ActiveAgentRun | null
  artifacts: ArtifactRecord[]
  forkState: ThreadForkState
  messageProjection: MessagesProjection
  messages: Message[]
  title: string | null
  todos: Todo[]
  workspacePath: string | null
  subagents: Subagent[]
  pendingApproval: HITLRequest | null
  error: string | null
  currentModel: string
  permissionMode: PermissionModeName
  openFiles: OpenFile[]
  openArtifacts: OpenArtifactTab[]
  activeTab: "agent" | string
  fileContents: Record<string, string>
  revision: number
  runId: string | null
  tokenUsage: TokenUsage | null
  draftInput: string
}

export interface ThreadActions {
  applyThreadDataSnapshot: (snapshot: AgentThreadDataSnapshot) => void
  applyRuntimeEvents: (events: AgentThreadEvent[]) => void
  setArtifacts: (artifacts: ArtifactRecord[]) => void
  setForkState: (forkState: ThreadForkState) => void
  appendMessage: (message: Message) => void
  setMessages: (messages: Message[]) => void
  setTodos: (todos: Todo[]) => void
  setWorkspacePath: (path: string | null) => void
  setSubagents: (subagents: Subagent[]) => void
  setPendingApproval: (request: HITLRequest | null) => void
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
  setDraftInput: (input: string) => void
}

export type ThreadRecord = ThreadState & ThreadActions

export interface ThreadStoreEffects {
  persistCurrentModel?: (threadId: string, modelId: string) => void | Promise<void>
  persistPermissionMode?: (
    threadId: string,
    permissionMode: PermissionModeName
  ) => void | Promise<void>
}

export interface ThreadStore {
  deleteThreadState: (threadId: string) => void
  ensureThreadState: (threadId: string) => boolean
  getAllStreamLoadingStates: () => Record<string, boolean>
  getAllThreadStates: () => Record<string, ThreadState>
  getStreamLoadingState: (threadId: string) => boolean
  getThreadActions: (threadId: string) => ThreadActions
  getThreadRecord: (threadId: string) => ThreadRecord
  getThreadState: (threadId: string) => ThreadState
  setStreamLoadingState: (threadId: string, isLoading: boolean) => void
  subscribeAllStreamLoadingStates: (listener: () => void) => () => void
  subscribeAllThreadStates: (listener: () => void) => () => void
  subscribeThread: (threadId: string, listener: () => void) => () => void
  updateThreadState: (
    threadId: string,
    updater: (prev: ThreadState) => Partial<ThreadState>
  ) => void
}

export function createDefaultThreadState(): ThreadState {
  return {
    activeRun: null,
    artifacts: [],
    forkState: {
      canFork: true
    },
    messageProjection: createDefaultMessagesProjection(),
    messages: [],
    title: null,
    todos: [],
    workspacePath: null,
    subagents: [],
    pendingApproval: null,
    error: null,
    currentModel: DEFAULT_MODELS.llm,
    permissionMode: DEFAULT_PERMISSION_MODE,
    openFiles: [],
    openArtifacts: [],
    activeTab: "agent",
    fileContents: {},
    revision: 0,
    runId: null,
    tokenUsage: null,
    draftInput: ""
  }
}

export function createThreadStore(effects: ThreadStoreEffects = {}): ThreadStore {
  const threadListeners = new Map<string, Set<() => void>>()
  const allThreadStateListeners = new Set<() => void>()
  const allStreamLoadingListeners = new Set<() => void>()
  const actionsCache: Record<string, ThreadActions> = {}
  const recordCache: Record<string, ThreadRecord> = {}
  let threadStates: Record<string, ThreadState> = {}
  let streamLoadingStates: Record<string, boolean> = {}

  const getThreadState = (threadId: string): ThreadState => {
    return threadStates[threadId] ?? createDefaultThreadState()
  }

  const emitThread = (threadId: string): void => {
    recordCache[threadId] = {
      ...getThreadState(threadId),
      ...getThreadActions(threadId)
    }
    threadListeners.get(threadId)?.forEach((listener) => listener())
    allThreadStateListeners.forEach((listener) => listener())
  }

  const hasThreadStateChanges = (
    current: ThreadState,
    nextPartial: Partial<ThreadState>
  ): boolean => {
    for (const key of Object.keys(nextPartial) as (keyof ThreadState)[]) {
      if (!Object.is(current[key], nextPartial[key])) {
        return true
      }
    }

    return false
  }

  const updateThreadState = (
    threadId: string,
    updater: (prev: ThreadState) => Partial<ThreadState>
  ): void => {
    const current = getThreadState(threadId)
    const nextPartial = updater(current)

    if (!hasThreadStateChanges(current, nextPartial)) {
      return
    }

    threadStates = {
      ...threadStates,
      [threadId]: {
        ...current,
        ...nextPartial
      }
    }
    emitThread(threadId)
  }

  const getThreadActions = (threadId: string): ThreadActions => {
    if (actionsCache[threadId]) {
      return actionsCache[threadId]
    }

    const actions: ThreadActions = {
      applyThreadDataSnapshot: (snapshot: AgentThreadDataSnapshot) => {
        updateThreadState(threadId, (state) => {
          return applyThreadDataSnapshotToThreadState(state, snapshot)
        })
      },
      applyRuntimeEvents: (events: AgentThreadEvent[]) => {
        if (events.length === 0) {
          return
        }

        updateThreadState(threadId, (state) => {
          const nextState = applyRuntimeEventsToThreadState(state, events)
          return createRuntimeThreadStateUpdate(nextState)
        })
      },
      appendMessage: (message: Message) => {
        updateThreadState(threadId, (state) => {
          const existingIndex = state.messages.findIndex((entry) => entry.id === message.id)
          if (existingIndex < 0) {
            const messages = [...state.messages, message]
            return {
              messageProjection: projectMessages(
                messages,
                state.messageProjection,
                state.activeRun
                  ? {
                      activeAssistantId: state.activeRun.assistantMessageId,
                      activeTurnKey: state.activeRun.turnId
                    }
                  : {}
              ),
              messages
            }
          }

          const nextMessages = [...state.messages]
          nextMessages[existingIndex] = message
          const messages = stabilizeThreadMessages(state.messages, nextMessages)
          return {
            messageProjection: projectMessages(
              messages,
              state.messageProjection,
              state.activeRun
                ? {
                    activeAssistantId: state.activeRun.assistantMessageId,
                    activeTurnKey: state.activeRun.turnId
                  }
                : {}
            ),
            messages
          }
        })
      },
      setMessages: (messages: Message[]) => {
        updateThreadState(threadId, (state) => {
          const stableMessages = stabilizeThreadMessages(state.messages, messages)
          return {
            messageProjection: projectMessages(
              stableMessages,
              state.messageProjection,
              state.activeRun
                ? {
                    activeAssistantId: state.activeRun.assistantMessageId,
                    activeTurnKey: state.activeRun.turnId
                  }
                : {}
            ),
            messages: stableMessages
          }
        })
      },
      setArtifacts: (artifacts: ArtifactRecord[]) => {
        updateThreadState(threadId, (state) => ({
          artifacts,
          openArtifacts: syncOpenArtifactTabs(state.openArtifacts, artifacts)
        }))
      },
      setForkState: (forkState: ThreadForkState) => {
        updateThreadState(threadId, () => ({ forkState }))
      },
      setTodos: (todos: Todo[]) => {
        updateThreadState(threadId, () => ({ todos }))
      },
      setWorkspacePath: (path: string | null) => {
        updateThreadState(threadId, () => ({ workspacePath: path }))
      },
      setSubagents: (subagents: Subagent[]) => {
        updateThreadState(threadId, () => ({ subagents }))
      },
      setPendingApproval: (request: HITLRequest | null) => {
        updateThreadState(threadId, () => ({ pendingApproval: request }))
      },
      setError: (error: string | null) => {
        updateThreadState(threadId, () => ({ error }))
      },
      clearError: () => {
        updateThreadState(threadId, () => ({ error: null }))
      },
      setCurrentModel: (modelId: string) => {
        updateThreadState(threadId, () => ({ currentModel: modelId }))
        void effects.persistCurrentModel?.(threadId, modelId)
      },
      setPermissionMode: (permissionMode: PermissionModeName) => {
        updateThreadState(threadId, () => ({ permissionMode }))
        void effects.persistPermissionMode?.(threadId, permissionMode)
      },
      openFile: (path: string, name: string) => {
        updateThreadState(threadId, (state) => {
          if (state.openFiles.some((file) => file.path === path)) {
            return {
              activeTab: path
            }
          }

          return {
            openFiles: [...state.openFiles, { path, name }],
            activeTab: path
          }
        })
      },
      closeFile: (path: string) => {
        updateThreadState(threadId, (state) => {
          const nextOpenFiles = state.openFiles.filter((file) => file.path !== path)
          const nextFileContents = { ...state.fileContents }
          delete nextFileContents[path]

          return {
            activeTab: getNextActiveTabAfterClose({
              activeTab: state.activeTab,
              closedTabId: path,
              openArtifacts: state.openArtifacts,
              openFiles: state.openFiles
            }),
            fileContents: nextFileContents,
            openFiles: nextOpenFiles
          }
        })
      },
      openArtifactTab: (tab: OpenArtifactTab) => {
        updateThreadState(threadId, (state) => {
          const nextTabId = getArtifactTabId(tab.artifactId)
          const existingTabIndex = state.openArtifacts.findIndex(
            (entry) => entry.artifactId === tab.artifactId
          )

          if (existingTabIndex >= 0) {
            const nextOpenArtifacts = [...state.openArtifacts]
            nextOpenArtifacts[existingTabIndex] = tab

            return {
              activeTab: nextTabId,
              openArtifacts: nextOpenArtifacts
            }
          }

          return {
            activeTab: nextTabId,
            openArtifacts: [...state.openArtifacts, tab]
          }
        })
      },
      closeArtifactTab: (artifactId: string) => {
        updateThreadState(threadId, (state) => ({
          activeTab: getNextActiveTabAfterClose({
            activeTab: state.activeTab,
            closedTabId: getArtifactTabId(artifactId),
            openArtifacts: state.openArtifacts,
            openFiles: state.openFiles
          }),
          openArtifacts: state.openArtifacts.filter((entry) => entry.artifactId !== artifactId)
        }))
      },
      setActiveTab: (tab: "agent" | string) => {
        updateThreadState(threadId, () => ({ activeTab: tab }))
      },
      setFileContents: (path: string, content: string) => {
        updateThreadState(threadId, (state) => ({
          fileContents: {
            ...state.fileContents,
            [path]: content
          }
        }))
      },
      setDraftInput: (input: string) => {
        updateThreadState(threadId, () => ({ draftInput: input }))
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
    const hadStreamLoadingState = Object.hasOwn(streamLoadingStates, threadId)

    if (!hadThreadState && !hadStreamLoadingState) {
      delete actionsCache[threadId]
      delete recordCache[threadId]
      return
    }

    if (hadThreadState) {
      const { [threadId]: _deletedThreadState, ...restThreadStates } = threadStates
      void _deletedThreadState
      threadStates = restThreadStates
      delete recordCache[threadId]
      delete actionsCache[threadId]
      threadListeners.get(threadId)?.forEach((listener) => listener())
      allThreadStateListeners.forEach((listener) => listener())
    }

    if (hadStreamLoadingState) {
      const { [threadId]: _deletedLoadingState, ...restLoadingStates } = streamLoadingStates
      void _deletedLoadingState
      streamLoadingStates = restLoadingStates
      allStreamLoadingListeners.forEach((listener) => listener())
    }
  }

  const setStreamLoadingState = (threadId: string, isLoading: boolean): void => {
    const current = streamLoadingStates[threadId] ?? false
    if (Object.is(current, isLoading)) {
      return
    }

    streamLoadingStates = {
      ...streamLoadingStates,
      [threadId]: isLoading
    }
    allStreamLoadingListeners.forEach((listener) => listener())
  }

  const getThreadRecord = (threadId: string): ThreadRecord => {
    if (!recordCache[threadId]) {
      recordCache[threadId] = {
        ...getThreadState(threadId),
        ...getThreadActions(threadId)
      }
    }

    return recordCache[threadId]
  }

  return {
    deleteThreadState,
    ensureThreadState,
    getAllStreamLoadingStates: () => streamLoadingStates,
    getAllThreadStates: () => threadStates,
    getStreamLoadingState: (threadId: string) => streamLoadingStates[threadId] ?? false,
    getThreadActions,
    getThreadRecord,
    getThreadState,
    setStreamLoadingState,
    subscribeAllStreamLoadingStates: (listener: () => void): (() => void) => {
      allStreamLoadingListeners.add(listener)
      return () => {
        allStreamLoadingListeners.delete(listener)
      }
    },
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
    },
    updateThreadState
  }
}
