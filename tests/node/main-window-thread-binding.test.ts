import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mainWindowThreadBindingSnapshotSchema } from "../../src/shared/durable-window"
import {
  startMainWindowThreadBindingProjection,
  type MainWindowThreadBindingProjection
} from "../../src/renderer/src/ai-core/main-window-thread-binding"

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function startProjection(input: {
  calls?: string[]
  onSnapshot: (threadId: string | null, revision: number) => void
  read: ReturnType<typeof deferred<{ revision: number; threadId: string | null }>>
}): {
  emit: (snapshot: { revision: number; threadId: string | null }) => void
  projection: MainWindowThreadBindingProjection
  unsubscribed: () => boolean
} {
  let listener: (snapshot: { revision: number; threadId: string | null }) => void = () => undefined
  let didUnsubscribe = false
  const projection = startMainWindowThreadBindingProjection({
    onError: (error) => {
      throw error
    },
    onSnapshot: (snapshot) => input.onSnapshot(snapshot.threadId, snapshot.revision),
    read: () => {
      input.calls?.push("read")
      return input.read.promise
    },
    subscribe: (next) => {
      input.calls?.push("subscribe")
      listener = next
      return () => {
        didUnsubscribe = true
      }
    }
  })
  return {
    emit: (snapshot) => listener(snapshot),
    projection,
    unsubscribed: () => didUnsubscribe
  }
}

describe("Main window thread binding projection", () => {
  it("subscribes before reading and rejects an older snapshot after a live event", async () => {
    const calls: string[] = []
    const projected: Array<[string | null, number]> = []
    const read = deferred<{ revision: number; threadId: string | null }>()
    const { emit, projection } = startProjection({
      calls,
      onSnapshot: (threadId, revision) => projected.push([threadId, revision]),
      read
    })

    assert.deepEqual(calls, ["subscribe", "read"])
    emit({ revision: 2, threadId: "thread-b" })
    read.resolve({ revision: 1, threadId: "thread-a" })
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.deepEqual(projected, [["thread-b", 2]])
    assert.deepEqual(projection.getCurrent(), { revision: 2, threadId: "thread-b" })
  })

  it("lets a local acknowledgement fence delayed older events without re-projecting", () => {
    const projected: Array<[string | null, number]> = []
    const read = deferred<{ revision: number; threadId: string | null }>()
    const { emit, projection } = startProjection({
      onSnapshot: (threadId, revision) => projected.push([threadId, revision]),
      read
    })

    emit({ revision: 2, threadId: "thread-b" })
    assert.deepEqual(projection.acknowledge({ revision: 3, threadId: "thread-c" }), {
      revision: 3,
      threadId: "thread-c"
    })
    emit({ revision: 2, threadId: "thread-b" })

    assert.deepEqual(projected, [["thread-b", 2]])
    assert.deepEqual(projection.getCurrent(), { revision: 3, threadId: "thread-c" })
  })

  it("isolates revisions across windows or renderer restarts and ignores disposed reads", async () => {
    const firstProjected: number[] = []
    const secondProjected: number[] = []
    const firstRead = deferred<{ revision: number; threadId: string | null }>()
    const secondRead = deferred<{ revision: number; threadId: string | null }>()
    const first = startProjection({
      onSnapshot: (_threadId, revision) => firstProjected.push(revision),
      read: firstRead
    })
    const second = startProjection({
      onSnapshot: (_threadId, revision) => secondProjected.push(revision),
      read: secondRead
    })

    first.emit({ revision: 9, threadId: "thread-a" })
    second.emit({ revision: 1, threadId: "thread-b" })
    first.projection.dispose()
    firstRead.resolve({ revision: 10, threadId: "thread-c" })
    secondRead.resolve({ revision: 2, threadId: "thread-d" })
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(first.unsubscribed(), true)
    assert.deepEqual(firstProjected, [9])
    assert.deepEqual(secondProjected, [1, 2])
    assert.deepEqual(second.projection.getCurrent(), { revision: 2, threadId: "thread-d" })
  })

  it("rejects malformed revisions and noncanonical thread ids", () => {
    assert.equal(
      mainWindowThreadBindingSnapshotSchema.safeParse({ revision: 1, threadId: null }).success,
      true
    )
    assert.equal(
      mainWindowThreadBindingSnapshotSchema.safeParse({ revision: 0, threadId: "thread-a" })
        .success,
      false
    )
    assert.equal(
      mainWindowThreadBindingSnapshotSchema.safeParse({
        revision: 1,
        threadId: " thread-a "
      }).success,
      false
    )
  })
})
