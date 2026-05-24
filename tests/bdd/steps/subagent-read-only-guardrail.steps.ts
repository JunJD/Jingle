import { Given, Then, When } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import { ToolMessage } from "@langchain/core/messages"
import { createSubagentReadOnlyGuardrailMiddleware } from "../../../src/main/agent/subagent-read-only-guardrail"
import { OpenworkWorld } from "../support/world"

const TOOL_CALL_ID = "subagent-tool-call-1"

interface GuardrailScenarioState {
  handlerCalls: Array<{ args: Record<string, unknown>; toolName: string }>
  middleware: ReturnType<typeof createSubagentReadOnlyGuardrailMiddleware> | null
  result: ToolMessage | null
}

interface GuardrailWorld extends OpenworkWorld {
  subagentGuardrailState?: GuardrailScenarioState
}

function getState(world: GuardrailWorld): GuardrailScenarioState {
  if (!world.subagentGuardrailState) {
    world.subagentGuardrailState = {
      handlerCalls: [],
      middleware: null,
      result: null
    }
  }

  return world.subagentGuardrailState
}

Given("子代理只读 guardrail 已启用", function (this: GuardrailWorld) {
  this.subagentGuardrailState = {
    handlerCalls: [],
    middleware: createSubagentReadOnlyGuardrailMiddleware({
      threadId: "bdd-thread",
      workspacePath: "/workspace"
    }),
    result: null
  }
})

When(
  "子代理请求调用 {string} 工具并传入参数:",
  async function (this: GuardrailWorld, toolName: string, rawArgs: string) {
    const state = getState(this)
    assert.ok(state.middleware?.wrapToolCall, "Expected subagent guardrail middleware to exist.")

    const parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>

    state.result = (await state.middleware.wrapToolCall(
      {
        toolCall: {
          args: parsedArgs,
          id: TOOL_CALL_ID,
          name: toolName,
          type: "tool_call"
        }
      } as never,
      async (request) => {
        state.handlerCalls.push({
          args: request.toolCall.args as Record<string, unknown>,
          toolName: request.toolCall.name
        })
        return new ToolMessage({
          content: "allowed by handler",
          name: request.toolCall.name,
          tool_call_id: request.toolCall.id ?? TOOL_CALL_ID
        })
      }
    )) as ToolMessage
  }
)

Then("该工具调用应被 guardrail 拒绝", function (this: GuardrailWorld) {
  const state = getState(this)
  assert.ok(state.result instanceof ToolMessage, "Expected guardrail to return a ToolMessage.")
  assert.equal(state.result.status, "error")
  assert.equal(state.handlerCalls.length, 0)
})

Then(
  "拒绝结果应关联 tool call id {string}",
  function (this: GuardrailWorld, expectedToolCallId: string) {
    const state = getState(this)
    assert.ok(state.result instanceof ToolMessage, "Expected a denied ToolMessage result.")
    assert.equal(state.result.tool_call_id, expectedToolCallId)
  }
)

Then("拒绝消息应提示交给父代理执行", function (this: GuardrailWorld) {
  const state = getState(this)
  assert.ok(state.result instanceof ToolMessage, "Expected a denied ToolMessage result.")
  const content = typeof state.result.content === "string" ? state.result.content : ""
  assert.match(content, /parent agent/i)
})

Then("该工具调用应继续交给底层处理器", function (this: GuardrailWorld) {
  const state = getState(this)
  assert.ok(state.result instanceof ToolMessage, "Expected handler to return a ToolMessage.")
  assert.equal(state.result.content, "allowed by handler")
  assert.equal(state.handlerCalls.length, 1)
})

Then("底层处理器收到的工具名应为 {string}", function (this: GuardrailWorld, toolName: string) {
  const state = getState(this)
  assert.equal(state.handlerCalls[0]?.toolName, toolName)
})
