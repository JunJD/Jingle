import assert from "node:assert/strict"
import test from "node:test"
import type { ExtensionRunBotAgentPayload } from "../../src/shared/extension-runtime-protocol"
import type { ProjectWorkflowDefinition } from "../../src/shared/thread-workflow"
import { RuntimeRunBotAgentRequestLifecycle } from "../../src/renderer/src/extension-runtime/run-bot-agent-request-lifecycle"
import { RunBotAgentConfirmationLifecycle } from "../../src/renderer/src/features/run-bot-agent/run-bot-agent-confirmation-lifecycle"
import {
  createConfirmedRunBotAgentWorkflow,
  resolveRunBotAgentConfirmation
} from "../../src/renderer/src/features/run-bot-agent/run-bot-agent-confirmation-model"
import { projectRunBotAgentPrompt } from "../../src/renderer/src/features/run-bot-agent/run-bot-agent-projection"

function payload(): ExtensionRunBotAgentPayload {
  return {
    prompt: {
      objective: "Fix the issue",
      contextRefs: [{ label: "Issue 42", type: "github-issue", url: "https://example.test/42" }]
    },
    sourceRef: {
      id: "42",
      label: "Issue 42",
      type: "github-issue",
      url: "https://example.test/42"
    },
    title: "Issue 42",
    workflow: {
      labels: [
        { key: "source", value: "github" },
        { key: "priority", value: "1" }
      ],
      status: "ready"
    }
  }
}

function project(): ProjectWorkflowDefinition {
  return {
    displayName: "Jingle",
    labels: [
      {
        color: null,
        key: "source",
        labelId: "label-source",
        name: "Source",
        orderIndex: 0,
        parentLabelId: null,
        projectId: "project-1",
        valueType: "string"
      },
      {
        color: null,
        key: "priority",
        labelId: "label-priority",
        name: "Priority",
        orderIndex: 1,
        parentLabelId: null,
        projectId: "project-1",
        valueType: "number"
      }
    ],
    projectId: "project-1",
    statuses: [
      {
        category: "open",
        color: null,
        icon: null,
        isDefault: true,
        isFixed: true,
        key: "ready",
        label: "Ready",
        orderIndex: 0,
        projectId: "project-1",
        statusId: "status-ready"
      }
    ],
    workspacePath: "/workspace/jingle"
  }
}

test("RunBot confirmation requires requested labels to use string definitions", () => {
  const input = payload()
  const invalid = resolveRunBotAgentConfirmation(input, project())
  assert.deepEqual(invalid.invalidLabelTypeKeys, ["priority"])
  assert.equal(createConfirmedRunBotAgentWorkflow(input, invalid), null)

  const stringProject = project()
  stringProject.labels[1] = { ...stringProject.labels[1]!, valueType: "string" }
  const valid = resolveRunBotAgentConfirmation(input, stringProject)
  assert.deepEqual(valid.invalidLabelTypeKeys, [])
  assert.deepEqual(createConfirmedRunBotAgentWorkflow(input, valid), {
    labels: [
      { key: "source", value: "github" },
      { key: "priority", value: "1" }
    ],
    primarySourceRef: input.sourceRef,
    statusKey: "ready"
  })
})

test("RunBot prompt projection preserves typed source and workflow facts", () => {
  assert.equal(
    projectRunBotAgentPrompt(payload()),
    [
      "Fix the issue",
      "",
      "Context:",
      "- Title: Issue 42",
      "- Source: Issue 42 (https://example.test/42)",
      "- Work classification: status=ready; labels=source=github, priority=1",
      "",
      "References:",
      "- Issue 42: https://example.test/42"
    ].join("\n")
  )
})

test("RunBot confirmation abort only clears the matching pending request", async () => {
  const lifecycle = new RunBotAgentConfirmationLifecycle<string>()
  const firstController = new AbortController()
  let firstAborts = 0
  const first = lifecycle.begin({
    concurrentError: "concurrent",
    onAbort: () => {
      firstAborts += 1
    },
    signal: firstController.signal
  })
  assert.equal(lifecycle.resolve(first, "first"), true)
  assert.equal(await first.promise, "first")

  const secondController = new AbortController()
  let secondAborts = 0
  const second = lifecycle.begin({
    concurrentError: "concurrent",
    onAbort: () => {
      secondAborts += 1
    },
    signal: secondController.signal
  })
  firstController.abort()
  assert.equal(lifecycle.isCurrent(second), true)
  assert.equal(firstAborts, 0)
  assert.equal(secondAborts, 0)

  const rejected = assert.rejects(second.promise, { name: "AbortError" })
  secondController.abort()
  await rejected
  assert.equal(secondAborts, 1)
  assert.equal(lifecycle.isCurrent(second), false)
})

test("Runtime RunBot request lifecycle aborts each request on session change", () => {
  const lifecycle = new RuntimeRunBotAgentRequestLifecycle()
  const first = lifecycle.begin("session-1", "request-1")
  const second = lifecycle.begin("session-1", "request-2")
  assert.notEqual(first.signal, second.signal)

  lifecycle.syncSession("session-2", false)
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, true)

  const current = lifecycle.begin("session-2", "request-1")
  lifecycle.release(first)
  assert.equal(current.signal.aborted, false)
  lifecycle.syncSession("session-2", true)
  assert.equal(current.signal.aborted, true)
})

test("Runtime RunBot request lifecycle supersedes duplicate request tokens", () => {
  const lifecycle = new RuntimeRunBotAgentRequestLifecycle()
  const first = lifecycle.begin("session-1", "request-1")
  const second = lifecycle.begin("session-1", "request-1")

  assert.equal(first.signal.aborted, true)
  assert.equal(lifecycle.isCurrent(first), false)
  assert.equal(lifecycle.isCurrent(second), true)
})
