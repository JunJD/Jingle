import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherAiController } from "../../src/renderer/src/ai-core/launcher-ai-controller"
import type { AgentControl } from "../../src/renderer/src/lib/use-agent"
import type { AiCoreThreadCreateInput } from "../../src/renderer/src/ai-core/AiCoreHost"
import type { ThreadActions } from "../../src/renderer/src/lib/thread-context"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { PermissionModeName } from "../../src/shared/permission-mode"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../src/shared/launcher-ai"

function createControllerHarness(input?: { threadId?: string | null }): {
  controller: ReturnType<typeof createLauncherAiController>
  createdThreads: AiCoreThreadCreateInput[]
  invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }>
  pendingInputs: string[]
  threadDraftInputs: string[]
} {
  const createdThreads: AiCoreThreadCreateInput[] = []
  const invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }> = []
  const pendingInputs: string[] = []
  const threadDraftInputs: string[] = []
  const agentControl: Pick<AgentControl, "clearError" | "invoke" | "resume"> = {
    clearError: () => {},
    invoke: async (messageInput, options) => {
      invoked.push({ input: messageInput, threadId: options?.threadId })
      return true
    },
    resume: async () => {}
  }
  const threadActions: Pick<
    ThreadActions,
    "setCurrentModel" | "setDraftInput" | "setPermissionMode"
  > | null = input?.threadId
    ? {
        setCurrentModel: () => {},
        setDraftInput: (value) => {
          threadDraftInputs.push(value)
        },
        setPermissionMode: () => {}
      }
    : null

  return {
    controller: createLauncherAiController({
      agentControl,
      branchThreadUntilMessage: async () => ({
        modelId: "model",
        threadId: "branched",
        workspacePath: "/workspace"
      }),
      createBranchThread: async () => ({
        modelId: "model",
        threadId: "branched",
        workspacePath: "/workspace"
      }),
      createThread: async (createInput) => {
        createdThreads.push(createInput)
        return {
          modelId: createInput.modelId ?? "default-model",
          threadId: "created-thread",
          workspacePath: "/workspace"
        }
      },
      currentModelId: "current-model",
      currentPermissionMode: "ask-to-edit" satisfies PermissionModeName,
      defaultDraftPermissionMode: "ask-to-edit",
      draftTarget: input?.threadId
        ? null
        : {
            kind: "draft",
            modelId: "draft-model",
            permissionMode: "explore"
          },
      goToNextThread: async () => null,
      goToPreviousThread: async () => null,
      hasPendingApproval: false,
      isBusy: false,
      setNavigationError: () => {},
      setPendingInput: (value) => {
        pendingInputs.push(value)
      },
      startFreshDraftTarget: async () => {},
      threadActions,
      threadId: input?.threadId ?? null,
      title: "AI Thread",
      updateFreshDraft: () => {}
    }),
    createdThreads,
    invoked,
    pendingInputs,
    threadDraftInputs
  }
}

test("launcher AI controller creates a draft thread before invoking agent commands", async () => {
  const harness = createControllerHarness()
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "整理这次性能问题"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [
    {
      draftInput: "整理这次性能问题",
      modelId: "draft-model",
      permissionMode: "explore",
      source: AI_THREAD_SOURCE,
      title: "AI Thread",
      visibility: AI_THREAD_VISIBILITY
    }
  ])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "created-thread" }])
})

test("launcher AI controller invokes the selected thread without creating another thread", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "existing-thread" }])
})

test("launcher AI controller routes query writes to the active thread draft", () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  harness.controller.setQuery("下一句")

  assert.deepEqual(harness.threadDraftInputs, ["下一句"])
  assert.deepEqual(harness.pendingInputs, [])
})
