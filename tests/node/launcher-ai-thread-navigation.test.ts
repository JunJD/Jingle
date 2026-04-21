import assert from "node:assert/strict"
import test from "node:test"
import {
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

test("shouldStartFreshLauncherAiThread starts fresh when launcher opens AI with a seed query", () => {
  assert.equal(shouldStartFreshLauncherAiThread({ seedQuery: "整理本周计划" }), true)
})

test("shouldStartFreshLauncherAiThread restores history when launcher opens AI without a seed query", () => {
  assert.equal(shouldStartFreshLauncherAiThread({ seedQuery: "   " }), false)
})
