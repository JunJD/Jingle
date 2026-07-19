import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherSearchInvoker } from "../../src/preload/api/launcher-search-lifecycle"
import type { LauncherSearchResponse } from "../../src/shared/launcher-search"

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const REQUEST = { limit: 10, query: "jingle", sources: ["applications" as const] }
const RESPONSE: LauncherSearchResponse = {
  query: "jingle",
  results: [],
  terminal: { kind: "complete" }
}

test("pre-aborted launcher search rejects without invoking main", async () => {
  const calls: string[] = []
  const search = createLauncherSearchInvoker(async (channel) => {
    calls.push(channel)
    return undefined as never
  })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    search(REQUEST, { signal: controller.signal }),
    (error: Error & { code?: string }) => error.code === "CANCELLED"
  )
  assert.deepEqual(calls, [])
})

test("aborting a pending launcher invoke sends one matching caller cancellation", async () => {
  const searchDeferred = createDeferred<LauncherSearchResponse>()
  const invocations: Array<{ args: unknown[]; channel: string }> = []
  const search = createLauncherSearchInvoker(
    async <TResult>(channel: string, ...args: unknown[]) => {
      invocations.push({ args, channel })
      if (channel === "launcher:search") {
        return searchDeferred.promise as Promise<TResult>
      }
      return true as TResult
    }
  )
  const controller = new AbortController()
  const pending = search(REQUEST, { signal: controller.signal })

  controller.abort()
  await Promise.resolve()
  assert.equal(invocations[0]?.channel, "launcher:search")
  assert.equal(invocations[1]?.channel, "launcher:cancelSearch")
  assert.deepEqual(
    (invocations[1]?.args[0] as { callerId: string }).callerId,
    (invocations[0]?.args[0] as { callerId: string }).callerId
  )

  searchDeferred.resolve(RESPONSE)
  await pending
  controller.abort()
  assert.equal(invocations.length, 2)
})

test("settled launcher invoke removes its abort listener", async () => {
  const invocations: string[] = []
  const search = createLauncherSearchInvoker(async <TResult>(channel: string) => {
    invocations.push(channel)
    return RESPONSE as TResult
  })
  const controller = new AbortController()

  await search(REQUEST, { signal: controller.signal })
  controller.abort()
  await Promise.resolve()
  assert.deepEqual(invocations, ["launcher:search"])
})
