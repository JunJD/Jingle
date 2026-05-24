import assert from "node:assert/strict"
import test from "node:test"
import type { Thread } from "../../src/shared/app-types"
import { createHistoryThreadOps } from "../../src/renderer/src/lib/history-thread-ops-core"

function createThread(id: string): Thread {
  return {
    thread_id: id,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    status: "idle"
  }
}

function createHistoryThreadStoreFixture(input?: {
  currentThreadId?: string | null
  loadThreadsResult?: Thread[]
  threads?: Thread[]
}): {
  getLoadCallCount: () => number
  getSelectCalls: () => string[]
  getState: () => {
    currentThreadId: string | null
    loadThreads: () => Promise<void>
    selectThread: (threadId: string) => Promise<void>
    threads: Thread[]
  }
} {
  let currentThreadId = input?.currentThreadId ?? null
  let loadCallCount = 0
  const selectCalls: string[] = []
  let threads = input?.threads ?? []

  return {
    getLoadCallCount: () => loadCallCount,
    getSelectCalls: () => [...selectCalls],
    getState: () => ({
      currentThreadId,
      loadThreads: async () => {
        loadCallCount += 1
        threads = input?.loadThreadsResult ?? threads
      },
      selectThread: async (threadId: string) => {
        currentThreadId = threadId
        selectCalls.push(threadId)
      },
      threads
    })
  }
}

test("activateHistoryThread loads threads and reloads the requested thread when it becomes available", async () => {
  const store = createHistoryThreadStoreFixture({
    loadThreadsResult: [createThread("thread-1"), createThread("thread-2")]
  })
  const ops = createHistoryThreadOps(store)
  const reloadCalls: string[] = []

  const matched = await ops.activateHistoryThread("thread-2", async (threadId) => {
    reloadCalls.push(threadId)
  })

  assert.equal(matched, true)
  assert.equal(store.getLoadCallCount(), 1)
  assert.deepEqual(store.getSelectCalls(), ["thread-2"])
  assert.deepEqual(reloadCalls, ["thread-2"])
})

test("openHistoryThread returns false when the requested thread is still missing after reload", async () => {
  const store = createHistoryThreadStoreFixture({
    loadThreadsResult: [createThread("thread-1")]
  })
  const ops = createHistoryThreadOps(store)
  const reloadCalls: string[] = []

  const matched = await ops.openHistoryThread("thread-missing", async (threadId) => {
    reloadCalls.push(threadId)
  })

  assert.equal(matched, false)
  assert.equal(store.getLoadCallCount(), 1)
  assert.deepEqual(store.getSelectCalls(), [])
  assert.deepEqual(reloadCalls, [])
})

test("refreshHistoryThreadsAndReloadActive reloads the current thread after refreshing threads", async () => {
  const store = createHistoryThreadStoreFixture({
    currentThreadId: "thread-active",
    loadThreadsResult: [createThread("thread-active"), createThread("thread-other")]
  })
  const ops = createHistoryThreadOps(store)
  const reloadCalls: string[] = []

  const threads = await ops.refreshHistoryThreadsAndReloadActive(async (threadId) => {
    reloadCalls.push(threadId)
  })

  assert.equal(store.getLoadCallCount(), 1)
  assert.deepEqual(
    threads.map((thread) => thread.thread_id),
    ["thread-active", "thread-other"]
  )
  assert.deepEqual(reloadCalls, ["thread-active"])
})
