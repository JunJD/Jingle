import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherAiController } from "../../src/renderer/src/ai-core/launcher-ai-controller"
import type { AgentControl } from "../../src/renderer/src/lib/use-agent"
import type { AiCoreThreadCreateInput } from "../../src/renderer/src/ai-core/AiCoreHost"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { PermissionModeName } from "../../src/shared/permission-mode"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../src/shared/launcher-ai"

function createControllerHarness(input?: {
  invokeResult?: boolean
  threadId?: string | null
}): {
  controller: ReturnType<typeof createLauncherAiController>
  createdThreads: AiCoreThreadCreateInput[]
  invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }>
  pendingInputs: string[]
  selectedModels: string[]
  selectedPermissionModes: PermissionModeName[]
  threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }>
} {
  const createdThreads: AiCoreThreadCreateInput[] = []
  const invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }> = []
  const pendingInputs: string[] = []
  const selectedModels: string[] = []
  const selectedPermissionModes: PermissionModeName[] = []
  const threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }> = []
  const agentControl: Pick<AgentControl, "clearError" | "invoke" | "resume"> = {
    clearError: () => {},
    invoke: async (messageInput, options) => {
      invoked.push({ input: messageInput, threadId: options?.threadId })
      return input?.invokeResult ?? true
    },
    resume: async () => {}
  }
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
      threadId: input?.threadId ?? null,
      title: "AI Thread",
      updateThread: async (threadId, update) => {
        threadUpdates.push({ metadata: update.metadata, threadId })
      },
      updateAgentThreadModel: async (commandInput) => {
        selectedModels.push(commandInput.modelId)
        await commandInput.updateThread(commandInput.threadId, {
          metadata: {
            model: commandInput.modelId
          }
        })
      },
      updateAgentThreadPermissionMode: async (commandInput) => {
        selectedPermissionModes.push(commandInput.permissionMode)
        await commandInput.updateThread(commandInput.threadId, {
          metadata: {
            permissionMode: commandInput.permissionMode
          }
        })
      },
      updateFreshDraft: () => {}
    }),
    createdThreads,
    invoked,
    pendingInputs,
    selectedModels,
    selectedPermissionModes,
    threadUpdates
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
      modelId: "draft-model",
      permissionMode: "explore",
      source: AI_THREAD_SOURCE,
      title: "AI Thread",
      visibility: AI_THREAD_VISIBILITY
    }
  ])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "created-thread" }])
  assert.deepEqual(harness.pendingInputs, [""])
})

test("launcher AI controller clears local composer after selected thread invoke succeeds", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "existing-thread" }])
  assert.deepEqual(harness.pendingInputs, [""])
})

test("launcher AI controller keeps local composer when invoke fails", async () => {
  const harness = createControllerHarness({
    invokeResult: false,
    threadId: "existing-thread"
  })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "existing-thread" }])
  assert.deepEqual(harness.pendingInputs, [])
})

test("launcher AI controller routes query writes to local composer state", () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  harness.controller.setQuery("下一句")

  assert.deepEqual(harness.pendingInputs, ["下一句"])
})


test("launcher AI controller routes selected thread settings through command layer", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  const didSelectModel = await harness.controller.selectModel("model-b")
  const didSelectPermissionMode = await harness.controller.selectPermissionMode("auto")

  assert.equal(didSelectModel, true)
  assert.equal(didSelectPermissionMode, true)
  assert.deepEqual(harness.selectedModels, ["model-b"])
  assert.deepEqual(harness.selectedPermissionModes, ["auto"])
  assert.deepEqual(harness.threadUpdates, [
    {
      metadata: {
        model: "model-b"
      },
      threadId: "existing-thread"
    },
    {
      metadata: {
        permissionMode: "auto"
      },
      threadId: "existing-thread"
    }
  ])
})
