import type {
  AgentThreadDataSnapshot,
  CreateThreadInput,
  ModelRuntimeSelection,
  Thread,
  ThreadModelRuntimeSelectionChangedEvent
} from "@shared/app-types"
import type { ArchivedThreadsView } from "@shared/thread-archive"
import { parseThreadModelRuntimeSelectionChangedEvent } from "@shared/model-runtime-selection"
import { invokeIpc, ipcRenderer } from "../ipc"

const MODEL_RUNTIME_SELECTION_CHANGED_CHANNEL = "threads:modelRuntimeSelectionChanged"
const latestModelRuntimeSelectionByThread = new Map<
  string,
  ThreadModelRuntimeSelectionChangedEvent
>()
const modelRuntimeSelectionChangedListeners = new Set<
  (event: ThreadModelRuntimeSelectionChangedEvent) => void
>()

ipcRenderer.on(MODEL_RUNTIME_SELECTION_CHANGED_CHANNEL, (_event, payload: unknown) => {
  const parsed = parseThreadModelRuntimeSelectionChangedEvent(payload)
  if (!parsed) {
    console.error("[Threads] Ignored an invalid model runtime selection event.")
    return
  }
  const previous = latestModelRuntimeSelectionByThread.get(parsed.threadId)
  if (previous && previous.revision >= parsed.revision) {
    return
  }
  latestModelRuntimeSelectionByThread.set(parsed.threadId, parsed)
  for (const listener of modelRuntimeSelectionChangedListeners) {
    listener(parsed)
  }
})

export const threadsApi = {
  list: (): Promise<Thread[]> => {
    return invokeIpc("threads:list")
  },
  listArchived: (): Promise<ArchivedThreadsView> => {
    return invokeIpc("threads:listArchived")
  },
  get: (threadId: string): Promise<Thread | null> => {
    return invokeIpc("threads:get", threadId)
  },
  create: (input?: CreateThreadInput): Promise<Thread> => {
    return invokeIpc("threads:create", input)
  },
  clone: (threadId: string): Promise<Thread> => {
    return invokeIpc("threads:clone", threadId)
  },
  cloneUntilMessage: (threadId: string, messageId: string): Promise<Thread> => {
    return invokeIpc("threads:cloneUntilMessage", threadId, messageId)
  },
  update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
    return invokeIpc("threads:update", { threadId, updates })
  },
  setModel: (threadId: string, selection: ModelRuntimeSelection): Promise<Thread> => {
    return invokeIpc("threads:setModel", { selection, threadId })
  },
  onModelRuntimeSelectionChanged: (
    listener: (event: ThreadModelRuntimeSelectionChangedEvent) => void
  ): (() => void) => {
    modelRuntimeSelectionChangedListeners.add(listener)
    for (const event of latestModelRuntimeSelectionByThread.values()) {
      listener(event)
    }
    return () => modelRuntimeSelectionChangedListeners.delete(listener)
  },
  setPinned: (threadId: string, pinned: boolean): Promise<Thread> => {
    return invokeIpc("threads:setPinned", { threadId, pinned })
  },
  setArchived: (threadId: string, archived: boolean): Promise<Thread> => {
    return invokeIpc("threads:setArchived", { threadId, archived })
  },
  delete: (threadId: string): Promise<void> => {
    return invokeIpc("threads:delete", threadId)
  },
  getAgentThreadData: (threadId: string): Promise<AgentThreadDataSnapshot> => {
    return invokeIpc("threads:agentThreadData", threadId)
  }
}
