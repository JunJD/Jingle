import assert from "node:assert/strict"
import test from "node:test"
import type {
  AgentThreadDataSnapshot,
  ModelConfig,
  ModelProviderState,
  Provider,
  Thread
} from "../../src/shared/app-types"
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
      get: async () => null,
      create: async (metadata?: Record<string, unknown>) =>
        createThread("thread-created", { metadata }),
      clone: async () => createThread("thread-clone"),
      cloneUntilMessage: async () => createThread("thread-clone"),
      update: async (threadId: string, updates: Partial<Thread>) => createThread(threadId, updates),
      delete: async () => undefined,
      getAgentThreadData: async (): Promise<AgentThreadDataSnapshot> => {
        throw new Error("Not implemented in test stub")
      },
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

test("createThread prepends the thread, selects it, and exits kanban mode", async () => {
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        create: async (metadata?: Record<string, unknown>) =>
          createThread("thread-new", { metadata, title: "Fresh thread" })
      }
    })
  )

  store.getState().setShowKanbanView(true)
  const thread = await store.getState().createThread({ source: "test" })
  const state = store.getState()

  assert.equal(thread.thread_id, "thread-new")
  assert.equal(state.currentThreadId, "thread-new")
  assert.equal(state.showKanbanView, false)
  assert.deepEqual(
    state.threads.map((candidate) => candidate.thread_id),
    ["thread-new"]
  )
  assert.deepEqual(state.threads[0]?.metadata, { source: "test" })
})

test("deleteThread removes the active thread and falls through to the next one", async () => {
  const threads = [createThread("thread-1"), createThread("thread-2"), createThread("thread-3")]
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        list: async () => threads
      }
    })
  )

  await store.getState().loadThreads()
  await store.getState().selectThread("thread-2")
  await store.getState().deleteThread("thread-2")

  const state = store.getState()
  assert.deepEqual(
    state.threads.map((candidate) => candidate.thread_id),
    ["thread-1", "thread-3"]
  )
  assert.equal(state.currentThreadId, "thread-1")
})

test("deleteThread rethrows failures and preserves current selection", async () => {
  const threads = [createThread("thread-1"), createThread("thread-2"), createThread("thread-3")]
  const deleteError = new Error("delete failed")
  const store = createHistoryShellStore(
    createApi({
      threads: {
        ...createApi().threads,
        list: async () => threads,
        delete: async () => {
          throw deleteError
        }
      }
    })
  )

  await store.getState().loadThreads()
  await store.getState().selectThread("thread-2")

  await assert.rejects(() => store.getState().deleteThread("thread-2"), deleteError)

  const state = store.getState()
  assert.deepEqual(
    state.threads.map((candidate) => candidate.thread_id),
    ["thread-1", "thread-2", "thread-3"]
  )
  assert.equal(state.currentThreadId, "thread-2")
})

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

  store.getState().setRightPanelTab("artifacts")
  store.getState().setSidebarCollapsed(true)
  unsubscribe()
  store.getState().setSidebarCollapsed(false)

  assert.equal(callCount, 2)
})

test("no-op ui state writes do not notify subscribers", () => {
  const store = createHistoryShellStore(createApi())
  let callCount = 0
  store.subscribe(() => {
    callCount += 1
  })

  store.getState().setRightPanelTab("todos")
  store.getState().setSidebarCollapsed(false)
  store.getState().setShowKanbanView(false)
  store.getState().setShowSubagentsInKanban(true)

  assert.equal(callCount, 0)
})
