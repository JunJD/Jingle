import assert from "node:assert/strict"
import test from "node:test"
import { Children, isValidElement, type ElementType, type ReactNode } from "react"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import { ToolContractNotice } from "../../src/renderer/src/components/chat/tools/shared-components"

function containsElementType(node: ReactNode, type: ElementType): boolean {
  if (!isValidElement(node)) return false
  if (node.type === type) return true
  const children = (node.props as { children?: ReactNode }).children
  return Children.toArray(children).some((child) => containsElementType(child, type))
}

test("Computer Use renderer registers every semantic tool and rejects mismatched state facts", async () => {
  await import("../../src/renderer/src/components/chat/tools/ComputerUseTool")
  const { getToolComponent } =
    await import("../../src/renderer/src/components/chat/tools/registry-core")
  const names = [
    "computer_use_observe",
    "computer_use_action",
    "computer_use_search",
    "computer_use_expand",
    "computer_use_inspect"
  ]
  for (const name of names) assert.ok(getToolComponent(name), `missing ${name}`)

  const search = getToolComponent("computer_use_search")!
  const missingSession = search.project({
    args: { query: "save", stateId: "state-1" },
    fileMutation: null,
    rawArgs: '{"query":"save","stateId":"state-1"}',
    rawResult: "",
    result: undefined,
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: { query: "save", stateId: "state-1" },
      id: "tool-search",
      name: "computer_use_search",
      type: "tool_call"
    }
  })
  const context = {
    commands: {
      openArtifact: async () => undefined,
      openExternal: async () => undefined
    },
    copy: appCopy["en-US"]
  }
  assert.equal(containsElementType(missingSession.renderDetail(context), ToolContractNotice), true)

  const observe = getToolComponent("computer_use_observe")!
  const missingApplicationId = observe.project({
    args: { applicationName: "Editor", windowId: "window-1" },
    fileMutation: null,
    rawArgs: '{"applicationName":"Editor","windowId":"window-1"}',
    rawResult: "{}",
    result: {},
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: { applicationName: "Editor", windowId: "window-1" },
      id: "tool-observe",
      name: "computer_use_observe",
      type: "tool_call"
    }
  })
  assert.equal(
    containsElementType(missingApplicationId.renderDetail(context), ToolContractNotice),
    true
  )

  const mismatchedResult = search.project({
    args: { query: "save", sessionId: "session-1", stateId: "state-1" },
    fileMutation: null,
    rawArgs: "{}",
    rawResult: "{}",
    result: {
      kind: "query",
      operation: "search",
      result: {
        elements: [],
        hasMore: false,
        stateId: "state-other",
        totalElements: 0,
        truncation: { byteLimit: 4096, omittedElements: 0, truncatedFields: 0 }
      },
      version: 1
    },
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: { query: "save", sessionId: "session-1", stateId: "state-1" },
      id: "tool-search",
      name: "computer_use_search",
      type: "tool_call"
    }
  })
  assert.equal(
    containsElementType(mismatchedResult.renderDetail(context), ToolContractNotice),
    true
  )

  const action = getToolComponent("computer_use_action")!
  const emptyActionResult = action.project({
    args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    fileMutation: null,
    rawArgs: "{}",
    rawResult: "{}",
    result: {},
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: {},
      id: "tool-action",
      name: "computer_use_action",
      type: "tool_call"
    }
  })
  assert.equal(
    containsElementType(emptyActionResult.renderDetail(context), ToolContractNotice),
    true
  )

  const validAction = action.project({
    args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    fileMutation: null,
    rawArgs: "{}",
    rawResult: "{}",
    result: {
      kind: "action",
      result: {
        baseStateId: "state-1",
        outcome: "didnt",
        steps: [
          {
            action: { kind: "press", ref: "@save" },
            evidence: {
              delivery: "semantic",
              noSideEffectProof: true,
              route: "ax_action",
              verification: "failed"
            },
            outcome: "didnt"
          }
        ],
        stoppedAt: 0
      },
      retry: { allowed: true, reason: "proven_no_side_effect" },
      version: 1
    },
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: {
        actions: [{ kind: "press", ref: "@save" }],
        sessionId: "session-1",
        stateId: "state-1"
      },
      id: "tool-valid-action",
      name: "computer_use_action",
      type: "tool_call"
    }
  })
  assert.equal(containsElementType(validAction.renderDetail(context), ToolContractNotice), false)

  const validSearch = search.project({
    args: { query: "save", sessionId: "session-1", stateId: "state-1" },
    fileMutation: null,
    rawArgs: "{}",
    rawResult: "{}",
    result: {
      kind: "query",
      operation: "search",
      result: {
        elements: [],
        hasMore: false,
        sourceTruncated: false,
        stateId: "state-1",
        totalElements: 0,
        truncation: { byteLimit: 4096, omittedElements: 0, truncatedFields: 0 }
      },
      version: 1
    },
    status: "complete",
    threadId: "thread-1",
    toolCall: {
      args: { query: "save", sessionId: "session-1", stateId: "state-1" },
      id: "tool-valid-search",
      name: "computer_use_search",
      type: "tool_call"
    }
  })
  assert.equal(containsElementType(validSearch.renderDetail(context), ToolContractNotice), false)
})
