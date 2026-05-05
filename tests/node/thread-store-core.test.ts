import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_PERMISSION_MODE } from "../../src/shared/permission-mode"
import type { ArtifactRecord } from "../../src/shared/artifacts"
import { createThreadStore } from "../../src/renderer/src/lib/thread-store-core"

function createLinkArtifact(props: {
  id: string
  threadId: string
  title: string
  toolCallId: string
}): ArtifactRecord {
  return {
    artifactKey: `${props.toolCallId}:0`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    kind: "link",
    messageId: null,
    mimeType: null,
    payload: null,
    previewText: null,
    runId: null,
    sizeBytes: null,
    source: {
      type: "external-url",
      uri: "https://example.com"
    },
    status: "ready",
    subtitle: null,
    threadId: props.threadId,
    title: props.title,
    toolCallId: props.toolCallId,
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  }
}

test("thread subscriptions stay scoped to the matching thread id", () => {
  const store = createThreadStore()
  let threadACalls = 0
  let allThreadCalls = 0

  const unsubscribeThread = store.subscribeThread("thread-a", () => {
    threadACalls += 1
  })
  const unsubscribeAll = store.subscribeAllThreadStates(() => {
    allThreadCalls += 1
  })

  store.ensureThreadState("thread-a")
  store.ensureThreadState("thread-b")
  store.getThreadActions("thread-a").setDraftInput("hello")

  unsubscribeThread()
  unsubscribeAll()

  assert.equal(threadACalls, 2)
  assert.equal(allThreadCalls, 3)
  assert.equal(store.getThreadRecord("thread-a").draftInput, "hello")
  assert.equal(store.getThreadRecord("thread-b").draftInput, "")
  assert.equal(store.getThreadRecord("thread-b").permissionMode, DEFAULT_PERMISSION_MODE)
})

test("setCurrentModel updates state and runs the injected persistence effect", () => {
  const persisted: Array<{ modelId: string; threadId: string }> = []
  const store = createThreadStore({
    persistCurrentModel: (threadId, modelId) => {
      persisted.push({ modelId, threadId })
    }
  })

  store.getThreadActions("thread-a").setCurrentModel("gpt-test")

  assert.equal(store.getThreadState("thread-a").currentModel, "gpt-test")
  assert.deepEqual(persisted, [{ modelId: "gpt-test", threadId: "thread-a" }])
})

test("setPermissionMode updates state and runs the injected persistence effect", () => {
  const persisted: Array<{ permissionMode: string; threadId: string }> = []
  const store = createThreadStore({
    persistPermissionMode: (threadId, permissionMode) => {
      persisted.push({ permissionMode, threadId })
    }
  })

  store.getThreadActions("thread-a").setPermissionMode("auto")

  assert.equal(store.getThreadState("thread-a").permissionMode, "auto")
  assert.deepEqual(persisted, [{ permissionMode: "auto", threadId: "thread-a" }])
})

test("setArtifacts refreshes metadata for already open artifact tabs", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.openArtifactTab({
    artifactId: "artifact-1",
    kind: "summary",
    title: "Old summary"
  })
  actions.setArtifacts([
    createLinkArtifact({
      id: "artifact-1",
      threadId: "thread-a",
      title: "Published link",
      toolCallId: "tool-call-1"
    })
  ])

  assert.deepEqual(store.getThreadState("thread-a").openArtifacts, [
    {
      artifactId: "artifact-1",
      kind: "link",
      title: "Published link"
    }
  ])
})

test("stream loading subscriptions only fire when the value actually changes", () => {
  const store = createThreadStore()
  let callCount = 0

  const unsubscribe = store.subscribeAllStreamLoadingStates(() => {
    callCount += 1
  })

  store.setStreamLoadingState("thread-a", true)
  store.setStreamLoadingState("thread-a", true)
  store.setStreamLoadingState("thread-a", false)
  unsubscribe()
  store.setStreamLoadingState("thread-a", true)

  assert.equal(callCount, 2)
  assert.equal(store.getStreamLoadingState("thread-a"), true)
})
