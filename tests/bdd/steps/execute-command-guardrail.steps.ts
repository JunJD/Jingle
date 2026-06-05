import { Given, Then, When } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import { createExecuteCommandGuardrailProvider } from "../../../src/main/agent/execute-command-guardrail-provider"
import { JustBashExecuteCommandClassifier } from "../../../src/main/agent/execute-command-classifier"
import type { GuardrailDecision } from "../../../src/main/agent/guardrail-middleware"
import type {
  MutationPrediction,
  MutationPredictionStatus
} from "../../../src/shared/mutation-prediction"
import { OpenworkWorld } from "../support/world"

interface ExecuteCommandGuardrailScenarioState {
  decision: GuardrailDecision | null
  predictorCalls: number
  prediction: MutationPrediction
}

interface ExecuteCommandGuardrailWorld extends OpenworkWorld {
  executeCommandGuardrailState?: ExecuteCommandGuardrailScenarioState
}

function getState(world: ExecuteCommandGuardrailWorld): ExecuteCommandGuardrailScenarioState {
  if (!world.executeCommandGuardrailState) {
    world.executeCommandGuardrailState = {
      decision: null,
      predictorCalls: 0,
      prediction: buildPrediction("predicted")
    }
  }

  return world.executeCommandGuardrailState
}

function getDecision(world: ExecuteCommandGuardrailWorld): GuardrailDecision {
  const decision = getState(world).decision
  assert.ok(decision, "Expected execute command guardrail decision to be available.")
  return decision
}

function isMutationPredictionStatus(value: string): value is MutationPredictionStatus {
  return (
    value === "predicted" ||
    value === "command_failed" ||
    value === "unsupported_command" ||
    value === "simulation_error" ||
    value === "timed_out" ||
    value === "unsupported_platform"
  )
}

function buildPrediction(status: MutationPredictionStatus): MutationPrediction {
  return {
    command: `python3 -c "open('notes.txt', 'w').write('hello')"`,
    status,
    confidence: status === "predicted" ? "medium" : status === "command_failed" ? "low" : "none",
    summary:
      status === "predicted"
        ? "Predicted 1 file change: create notes.txt."
        : status === "unsupported_command"
          ? "Simulator could not execute this command in just-bash, so target files are unknown."
          : `Prediction finished with status ${status}.`,
    changes:
      status === "predicted"
        ? [
            {
              changeType: "create",
              path: "notes.txt"
            }
          ]
        : [],
    durationMs: 12,
    exitCode: status === "predicted" ? 0 : status === "unsupported_command" ? 127 : null,
    stderr: null
  }
}

Given(
  "预测器会返回 {string} 状态",
  function (this: ExecuteCommandGuardrailWorld, rawStatus: string) {
    assert.ok(
      isMutationPredictionStatus(rawStatus),
      `Unsupported mutation prediction status for BDD scenario: ${rawStatus}`
    )

    const state = getState(this)
    state.prediction = buildPrediction(rawStatus)
    state.predictorCalls = 0
    state.decision = null
  }
)

When(
  "系统使用受控 shell 守卫评估命令 {string}",
  async function (this: ExecuteCommandGuardrailWorld, command: string) {
    const state = getState(this)
    const provider = createExecuteCommandGuardrailProvider({
      classifier: new JustBashExecuteCommandClassifier(),
      predictor: {
        async predictExecute(predictedCommand: string) {
          state.predictorCalls += 1
          return {
            ...state.prediction,
            command: predictedCommand
          }
        }
      }
    })

    state.decision = await provider.evaluate({
      toolName: "execute",
      toolInput: { command },
      threadId: "bdd-thread-1",
      workspacePath: "/workspace",
      timestamp: "2026-04-29T12:00:00.000Z"
    })
  }
)

Then("守卫结果应为 {string}", function (this: ExecuteCommandGuardrailWorld, outcome: string) {
  assert.equal(getDecision(this).allow ? "allow" : "deny", outcome)
})

Then("守卫记录的分类应为 {string}", function (this: ExecuteCommandGuardrailWorld, profile: string) {
  assert.equal(getDecision(this).metadata?.executeCommandPolicy?.profile, profile)
})

Then(
  "守卫记录的处置应为 {string}",
  function (this: ExecuteCommandGuardrailWorld, disposition: string) {
    assert.equal(getDecision(this).metadata?.executeCommandPolicy?.disposition, disposition)
  }
)

Then(
  "守卫记录的预测状态应为 {string}",
  function (this: ExecuteCommandGuardrailWorld, status: string) {
    assert.equal(getDecision(this).metadata?.mutationPrediction?.status, status)
  }
)

Then(
  "守卫拒绝原因应包含 {string}",
  function (this: ExecuteCommandGuardrailWorld, fragment: string) {
    const message = getDecision(this).reasons?.[0]?.message ?? ""
    assert.match(message, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
  }
)

Then(
  "守卫记录原因应包含 {string}",
  function (this: ExecuteCommandGuardrailWorld, fragment: string) {
    const reason = getDecision(this).metadata?.executeCommandPolicy?.reason ?? ""
    assert.match(reason, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
  }
)

Then(
  "预测器调用次数应为 {int}",
  function (this: ExecuteCommandGuardrailWorld, expectedCalls: number) {
    assert.equal(getState(this).predictorCalls, expectedCalls)
  }
)
