import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import { createAgentRunSteeringBuffer, createRunSteeringMiddleware } from "../../src/main/agent/run-steering"

test("run steering reports accepted steers only after they are injected into a model call", async () => {
  const appliedMessageIds: string[] = []
  const buffer = createAgentRunSteeringBuffer({
    onSteersApplied: (steers) => {
      appliedMessageIds.push(...steers.map((steer) => steer.messageId))
    }
  })
  const middleware = createRunSteeringMiddleware(buffer)

  buffer.accept({
    message: {
      content: "focus on tests",
      id: "steer-message-1"
    },
    runId: "run-1"
  })
  assert.deepEqual(appliedMessageIds, [])

  let observedMessages: unknown[] = []
  await middleware.wrapModelCall!(
    {
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })]
    } as never,
    async (request) => {
      observedMessages = request.messages
      return new AIMessage("done")
    }
  )

  assert.deepEqual(appliedMessageIds, ["steer-message-1"])
  assert.equal(observedMessages.length, 2)
  const injectedMessage = observedMessages[1]
  assert.ok(HumanMessage.isInstance(injectedMessage))
  assert.equal(injectedMessage.id, "steer-message-1")
  assert.equal(injectedMessage.content, "focus on tests")
})
