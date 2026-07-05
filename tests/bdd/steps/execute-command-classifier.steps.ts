import { Then, When } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import type { ExecuteCommandPolicy } from "../../../src/shared/execute-command-policy"
import { JustBashExecuteCommandClassifier } from "../../../src/main/agent/execute-command-classifier"
import { JingleWorld } from "../support/world"

interface ExecuteCommandClassifierScenarioState {
  policy: ExecuteCommandPolicy | null
}

interface ExecuteCommandClassifierWorld extends JingleWorld {
  executeCommandClassifierState?: ExecuteCommandClassifierScenarioState
}

const classifier = new JustBashExecuteCommandClassifier()

function getState(
  world: ExecuteCommandClassifierWorld
): ExecuteCommandClassifierScenarioState {
  if (!world.executeCommandClassifierState) {
    world.executeCommandClassifierState = {
      policy: null
    }
  }

  return world.executeCommandClassifierState
}

function getPolicy(world: ExecuteCommandClassifierWorld): ExecuteCommandPolicy {
  const policy = getState(world).policy
  assert.ok(policy, "Expected execute command classifier policy to be available.")
  return policy
}

function parseExpectedList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

When("系统分类命令 {string}", function (this: ExecuteCommandClassifierWorld, command: string) {
  getState(this).policy = classifier.classify(command)
})

When("系统分类命令:", function (this: ExecuteCommandClassifierWorld, command: string) {
  getState(this).policy = classifier.classify(command)
})

Then("分类结果应为 {string}", function (this: ExecuteCommandClassifierWorld, profile: string) {
  assert.equal(getPolicy(this).profile, profile)
})

Then("处置应为 {string}", function (this: ExecuteCommandClassifierWorld, disposition: string) {
  assert.equal(getPolicy(this).disposition, disposition)
})

Then("分类原因应包含 {string}", function (this: ExecuteCommandClassifierWorld, fragment: string) {
  assert.ok(
    getPolicy(this).reason.includes(fragment),
    `Expected reason to include "${fragment}", got "${getPolicy(this).reason}".`
  )
})

Then(
  "识别出的命令列表应为 {string}",
  function (this: ExecuteCommandClassifierWorld, expectedCommands: string) {
    assert.deepEqual(getPolicy(this).commands, parseExpectedList(expectedCommands))
  }
)

Then("识别出的命令列表应为空", function (this: ExecuteCommandClassifierWorld) {
  assert.deepEqual(getPolicy(this).commands, [])
})

Then("网络目标应为 {string}", function (this: ExecuteCommandClassifierWorld, expectedTargets: string) {
  assert.deepEqual(getPolicy(this).networkTargets ?? [], parseExpectedList(expectedTargets))
})
