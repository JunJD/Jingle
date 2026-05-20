import assert from "node:assert/strict"
import test from "node:test"
import {
  resolveLauncherAiAdjacentThreadIds,
  shouldReloadLauncherAiThreadOnActivate,
  shouldReloadLauncherAiThreadOnFocus,
  shouldStartFreshLauncherAiThread
} from "../../src/renderer/src/ai-core/launcher-ai-thread-navigation-core"

test("shouldReloadLauncherAiThreadOnFocus skips reload while the active thread is streaming", () => {
  assert.equal(
    shouldReloadLauncherAiThreadOnFocus({
      activeThreadId: "thread-1",
      isStreaming: true
    }),
    false
  )
})

test("shouldReloadLauncherAiThreadOnFocus allows reload when the active thread is idle", () => {
  assert.equal(
    shouldReloadLauncherAiThreadOnFocus({
      activeThreadId: "thread-1",
      isStreaming: false
    }),
    true
  )
})

test("shouldReloadLauncherAiThreadOnFocus skips reload when there is no active thread", () => {
  assert.equal(
    shouldReloadLauncherAiThreadOnFocus({
      activeThreadId: null,
      isStreaming: false
    }),
    false
  )
})

test("shouldReloadLauncherAiThreadOnActivate skips reload while the target thread is streaming", () => {
  assert.equal(
    shouldReloadLauncherAiThreadOnActivate({
      isStreaming: true
    }),
    false
  )
})

test("shouldReloadLauncherAiThreadOnActivate reloads when the target thread is idle", () => {
  assert.equal(
    shouldReloadLauncherAiThreadOnActivate({
      isStreaming: false
    }),
    true
  )
})

test("shouldStartFreshLauncherAiThread starts fresh when launcher opens AI with a seed query", () => {
  assert.equal(shouldStartFreshLauncherAiThread({ seedQuery: "整理本周计划" }), true)
})

test("shouldStartFreshLauncherAiThread restores history when launcher opens AI without a seed query", () => {
  assert.equal(shouldStartFreshLauncherAiThread({ seedQuery: "   " }), false)
})

test("resolveLauncherAiAdjacentThreadIds treats fresh draft as newest non-persisted entry", () => {
  assert.deepEqual(
    resolveLauncherAiAdjacentThreadIds({
      activeThreadId: null,
      isFreshDraftActive: true,
      threadIdsByRecency: ["thread-newest", "thread-older"]
    }),
    {
      next: null,
      previous: "thread-newest"
    }
  )
})

test("resolveLauncherAiAdjacentThreadIds returns persisted neighbors by recency", () => {
  assert.deepEqual(
    resolveLauncherAiAdjacentThreadIds({
      activeThreadId: "thread-middle",
      isFreshDraftActive: false,
      threadIdsByRecency: ["thread-newest", "thread-middle", "thread-oldest"]
    }),
    {
      next: "thread-newest",
      previous: "thread-oldest"
    }
  )
})
