import assert from "node:assert/strict"
import test from "node:test"
import type {
  AgentThreadDataSnapshot,
  CreateThreadInput,
  ModelConfig,
  ModelProviderState,
  Provider,
  Thread
} from "../../src/shared/app-types"
import { DEFAULT_THREAD_SIDEBAR_PREFERENCES } from "../../src/shared/thread-sidebar"
import {
  createHistoryShellStore,
  type HistoryShellApi
} from "../../src/renderer/src/lib/history-shell-store-core"

function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    thread_id: id,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    status: "idle",
    ...overrides
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    configurateMethods: ["fetch-from-remote"],
    customConfiguration: {
      status: "active"
    },
    id: "openai",
    label: {
      en_US: "OpenAI",
      zh_Hans: "OpenAI"
    },
    modelListStatus: "active",
    name: "OpenAI",
    providerCredentialSchema: {
      credentialFormSchemas: []
    },
    supportedModelTypes: ["llm"],
    systemConfiguration: {
      enabled: true
    },
    ...overrides
  }
}

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    fetchFrom: "fetch-from-remote",
    id: "openai:gpt-4o",
    model: "gpt-4o",
    modelType: "llm",
    name: "GPT-4o",
    provider: "openai",
    status: "active",
    ...overrides
  }
}

function createApi(overrides: Partial<HistoryShellApi> = {}): HistoryShellApi {
  const providerState: ModelProviderState = {
    activeProviderId: "openai",
    defaultModelOptions: {
      llm: {
        thinkingEffort: null
      }
    },
    defaultModels: {
      llm: "openai:gpt-4o"
    },
    providers: [createProvider()]
  }
  const models = [createModel()]

  return {
    threads: {
      list: async () => [],
      listArchived: async () => ({
        projects: [],
        threads: []
      }),
      get: async () => null,
      create: async (input?: CreateThreadInput) =>
        createThread("thread-created", { metadata: input?.metadata }),
      clone: async () => createThread("thread-clone"),
      cloneUntilMessage: async () => createThread("thread-clone"),
      update: async (threadId: string, updates: Partial<Thread>) => createThread(threadId, updates),
      setPinned: async (threadId: string, pinned: boolean) =>
        createThread(threadId, { metadata: pinned ? { pinned } : {} }),
      setArchived: async (threadId: string, archived: boolean) =>
        createThread(threadId, {
          archived_at: archived ? new Date("2026-01-03T00:00:00.000Z") : null
        }),
      delete: async () => undefined,
      getAgentThreadData: async (): Promise<AgentThreadDataSnapshot> => {
        throw new Error("Not implemented in test stub")
      },
    },
    threadSidebar: {
      getView: async () => ({
        chatThreads: [],
        pinnedThreads: [],
        preferences: DEFAULT_THREAD_SIDEBAR_PREFERENCES,
        projectGroups: []
      }),
      reorderProjects: async () => ({
        chatThreads: [],
        pinnedThreads: [],
        preferences: DEFAULT_THREAD_SIDEBAR_PREFERENCES,
        projectGroups: []
      }),
      setOrganizeMode: async () => ({
        chatThreads: [],
        pinnedThreads: [],
        preferences: DEFAULT_THREAD_SIDEBAR_PREFERENCES,
        projectGroups: []
      }),
      setSortBy: async () => ({
        chatThreads: [],
        pinnedThreads: [],
        preferences: DEFAULT_THREAD_SIDEBAR_PREFERENCES,
        projectGroups: []
      })
    },
    threadWorkspace: {
      addProject: async () => ({
        archivedAt: null,
        canonicalWorkspacePath: "/tmp/jingle",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        displayName: "jingle",
        projectId: "/tmp/jingle",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        workspaceKey: "/tmp/jingle"
      }),
      bindProject: async (threadId: string, workspacePath: string) => ({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        project: null,
        projectId: workspacePath,
        threadId,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        workspaceKey: workspacePath,
        workspaceKind: "project",
        workspacePath
      }),
      get: async () => null,
      markProjectless: async (threadId: string) => ({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        project: null,
        projectId: null,
        threadId,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        workspaceKey: null,
        workspaceKind: "projectless",
        workspacePath: null
      })
    },
    workspace: {
      get: async () => null,
      set: async () => null,
      select: async () => null,
      selectFolder: async () => null,
      createDefault: async () => "/tmp/jingle",
      readFile: async () => ({
        success: false,
        error: "Not implemented in test stub"
      }),
      readBinaryFile: async () => ({
        success: false,
        error: "Not implemented in test stub"
      }),
      searchFiles: async () => ({
        success: true,
        files: []
      })
    },
    models: {
      getState: async () => providerState,
      getPaths: async () => ({
        authPath: "/tmp/jingle/auth.json",
        configPath: "/tmp/jingle/config.yaml",
        customProvidersDir: "/tmp/jingle/custom_providers",
        modelRegistryPath: "/tmp/jingle/models/registry.json"
      }),
      list: async () => models,
      listByProvider: async () => {
        throw new Error("Not implemented in test stub")
      },
      getDefault: async () => "openai:gpt-4o",
      setDefault: async () => undefined,
      setCredentials: async () => undefined,
      getCredentials: async () => null,
      getCustomProvider: async () => null,
      deleteCredentials: async () => undefined,
      upsertCustomProvider: async () => "custom_test"
    },
    ...overrides
  }
}

test("refreshThread updates only the requested thread and re-sorts by recency", async () => {
  const initialThreads = [
    createThread("thread-old", { title: "Old" }),
    createThread("thread-current", { title: "Current" })
  ]
  const refreshedThread = createThread("thread-current", {
    title: "Current (Updated)",
    updated_at: new Date("2026-01-02T00:00:00.000Z")
  })
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        get: async (threadId: string) => {
          if (threadId === "thread-current") {
            return refreshedThread
          }

          return initialThreads.find((thread) => thread.thread_id === threadId) ?? null
        },
        list: async () => initialThreads
      }
    })
  )

  await store.getState().loadThreads()
  await store.getState().refreshThread("thread-current")

  const state = store.getState()
  assert.deepEqual(
    state.threads.map((thread) => ({
      thread_id: thread.thread_id,
      title: thread.title
    })),
    [
      {
        thread_id: "thread-current",
        title: "Current (Updated)"
      },
      {
        thread_id: "thread-old",
        title: "Old"
      }
    ]
  )
})

test("setThreadPinned updates thread metadata without re-sorting recency", async () => {
  const threads = [
    createThread("thread-newer", { updated_at: new Date("2026-01-02T00:00:00.000Z") }),
    createThread("thread-older", { updated_at: new Date("2026-01-01T00:00:00.000Z") })
  ]
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        list: async () => threads,
        setPinned: async (threadId: string, pinned: boolean) =>
          createThread(threadId, {
            metadata: { pinned },
            updated_at: threadId === "thread-older" ? threads[1]!.updated_at : threads[0]!.updated_at
          })
      }
    })
  )

  await store.getState().loadThreads()
  await store.getState().setThreadPinned("thread-older", true)

  const state = store.getState()
  assert.deepEqual(
    state.threads.map((thread) => thread.thread_id),
    ["thread-newer", "thread-older"]
  )
  assert.deepEqual(state.threads[1]?.metadata, { pinned: true })
})

test("setThreadArchived removes archived threads from active history state", async () => {
  const threads = [
    createThread("thread-newer", { updated_at: new Date("2026-01-02T00:00:00.000Z") }),
    createThread("thread-older", { updated_at: new Date("2026-01-01T00:00:00.000Z") })
  ]
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        list: async () => threads,
        setArchived: async (threadId: string, archived: boolean) =>
          createThread(threadId, {
            archived_at: archived ? new Date("2026-01-03T00:00:00.000Z") : null,
            updated_at: threadId === "thread-newer" ? threads[0]!.updated_at : threads[1]!.updated_at
          })
      }
    })
  )

  await store.getState().loadThreads()
  await store.getState().setThreadArchived("thread-newer", true)

  assert.deepEqual(
    store.getState().threads.map((thread) => thread.thread_id),
    ["thread-older"]
  )
})

test("addSidebarProject creates a project from a selected folder and refreshes project grouping", async () => {
  const calls: string[] = []
  const nextView = {
    chatThreads: [],
    pinnedThreads: [],
    preferences: {
      ...DEFAULT_THREAD_SIDEBAR_PREFERENCES,
      organizeMode: "project" as const
    },
    projectGroups: [
      {
        projectId: "/tmp/jingle",
        threads: [],
        title: "jingle",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        workspacePath: "/tmp/jingle"
      }
    ]
  }
  const store = createHistoryShellStore(
    createApi({
      threadSidebar: {
        ...createApi().threadSidebar,
        setOrganizeMode: async (mode) => {
          calls.push(`organize:${mode}`)
          return nextView
        }
      },
      threadWorkspace: {
        ...createApi().threadWorkspace,
        addProject: async (workspacePath) => {
          calls.push(`project:${workspacePath}`)
          return {
            archivedAt: null,
            canonicalWorkspacePath: workspacePath,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            displayName: "jingle",
            projectId: workspacePath,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            workspaceKey: workspacePath
          }
        }
      },
      workspace: {
        ...createApi().workspace,
        selectFolder: async () => {
          calls.push("select")
          return "/tmp/jingle"
        }
      }
    })
  )

  await store.getState().addSidebarProject()

  assert.deepEqual(calls, ["select", "project:/tmp/jingle", "organize:project"])
  assert.deepEqual(store.getState().sidebarView, nextView)
})

test("addSidebarProject leaves sidebar state unchanged when folder selection is canceled", async () => {
  let addProjectCalled = false
  const store = createHistoryShellStore(
    createApi({
      threadWorkspace: {
        ...createApi().threadWorkspace,
        addProject: async (workspacePath) => {
          addProjectCalled = true
          return {
            archivedAt: null,
            canonicalWorkspacePath: workspacePath,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            displayName: "jingle",
            projectId: workspacePath,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            workspaceKey: workspacePath
          }
        }
      },
      workspace: {
        ...createApi().workspace,
        selectFolder: async () => null
      }
    })
  )

  await store.getState().addSidebarProject()

  assert.equal(addProjectCalled, false)
  assert.equal(store.getState().sidebarView, null)
})

test("setProviderCredentials refreshes provider and model state after persisting credentials", async () => {
  let loadCount = 0
  let credentialsCall: { providerId: string; credentials: Record<string, string> } | null = null
  const providers = [
    createProvider({
      customConfiguration: {
        status: "active"
      }
    })
  ]
  const models = [createModel({ id: "openai:gpt-5", model: "gpt-5", name: "GPT-5" })]

  const store = createHistoryShellStore(
    createApi({
      models: {
        ...createApi().models,
        getState: async () => {
          loadCount += 1
          return {
            activeProviderId: "openai",
            defaultModelOptions: {
              llm: {
                thinkingEffort: null
              }
            },
            defaultModels: {
              llm: "openai:gpt-5"
            },
            providers
          }
        },
        list: async () => models,
        setCredentials: async (providerId, credentials) => {
          credentialsCall = { providerId, credentials }
        }
      }
    })
  )

  await store.getState().setProviderCredentials("openai", { apiKey: "sk-test" })
  const state = store.getState()

  assert.deepEqual(credentialsCall, {
    providerId: "openai",
    credentials: { apiKey: "sk-test" }
  })
  assert.equal(loadCount, 1)
  assert.deepEqual(state.providers, providers)
  assert.deepEqual(state.models, models)
})

test("subscribe emits only when the store mutates", async () => {
  const store = createHistoryShellStore(createApi())
  let callCount = 0
  const unsubscribe = store.subscribe(() => {
    callCount += 1
  })

  await store.getState().loadThreads()
  await store.getState().loadModelProviderState()
  unsubscribe()
  await store.getState().loadThreads()

  assert.equal(callCount, 2)
})

test("no-op state writes do not notify subscribers", () => {
  const store = createHistoryShellStore(createApi())
  let callCount = 0
  store.subscribe(() => {
    callCount += 1
  })

  // No-op: currentThreadId is already null
  const state = store.getState()
  assert.equal(state.currentThreadId, null)

  assert.equal(callCount, 0)
})
