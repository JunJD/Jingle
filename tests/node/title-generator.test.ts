import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import {
  createJingleTitleGenerator,
  isJingleTitleGenerationAbort
} from "../../packages/langchain-agent-harness/src/title-generator"

test("title generator treats model aborts as expected title-generation cancellation", async () => {
  const abortSignal = Symbol("langchain.error.model-abort")
  const abortError = Object.assign(new Error("aborted"), {
    [abortSignal]: true
  })
  const loggedErrors: unknown[] = []
  const generateTitle = createJingleTitleGenerator({
    createModel: () => ({
      withConfig: () => ({
        invoke: async () => {
          throw abortError
        }
      })
    }),
    onError: (error) => {
      loggedErrors.push(error)
    },
    timeoutMs: 1
  })

  const result = await generateTitle({
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: null
  })

  assert.equal(result, null)
  assert.equal(isJingleTitleGenerationAbort(abortError), true)
  assert.deepEqual(loggedErrors, [])
})

test("title generator still reports non-abort failures", async () => {
  const failure = new Error("provider misconfigured")
  const loggedErrors: unknown[] = []
  const generateTitle = createJingleTitleGenerator({
    createModel: () => ({
      withConfig: () => ({
        invoke: async () => {
          throw failure
        }
      })
    }),
    onError: (error) => {
      loggedErrors.push(error)
    },
    timeoutMs: 1
  })

  const result = await generateTitle({
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: null
  })

  assert.equal(result, null)
  assert.deepEqual(loggedErrors, [failure])
})
