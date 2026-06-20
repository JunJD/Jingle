import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherAiController } from "../../src/renderer/src/ai-core/launcher-ai-controller"
import type { AgentControl } from "../../src/renderer/src/lib/use-agent"
import type { AiCoreThreadCreateInput } from "../../src/renderer/src/ai-core/AiCoreHost"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { PermissionModeName } from "../../src/shared/permission-mode"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../src/shared/launcher-ai"

function createControllerHarness(input?: {
  draftWorkspacePath?: string | null
  invokeGate?: Promise<void>
  invokeResult?: boolean
  resumeResult?: boolean
  threadId?: string | null
}): {
  controller: ReturnType<typeof createLauncherAiController>
  createdThreads: AiCoreThreadCreateInput[]
  editedMessages: Array<{
    input: { messageId: string; messageInput: ComposerMessageInput }
    threadId: string | undefined
  }>
  invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }>
  localComposerTexts: string[]
  navigationErrors: Array<string | null>
  resumedDecisions: unknown[]
  selectedModels: string[]
  selectedPermissionModes: PermissionModeName[]
  startedDrafts: Array<{
    modelId: string | null
    permissionMode: PermissionModeName
    workspacePath?: string | null
  }>
  threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }>
} {
  const createdThreads: AiCoreThreadCreateInput[] = []
  const editedMessages: Array<{
    input: { messageId: string; messageInput: ComposerMessageInput }
    threadId: string | undefined
  }> = []
  const invoked: Array<{ input: ComposerMessageInput; threadId: string | undefined }> = []
  const localComposerTexts: string[] = []
  const navigationErrors: Array<string | null> = []
  const resumedDecisions: unknown[] = []
  const selectedModels: string[] = []
  const selectedPermissionModes: PermissionModeName[] = []
  const startedDrafts: Array<{
    modelId: string | null
    permissionMode: PermissionModeName
    workspacePath?: string | null
  }> = []
  const threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }> = []
  const agentControl: Pick<
    AgentControl,
    "clearError" | "editLastUserMessageAndInvoke" | "invoke" | "resume"
  > = {
    clearError: () => {},
    editLastUserMessageAndInvoke: async (editInput, options) => {
      editedMessages.push({ input: editInput, threadId: options?.threadId })
      return true
    },
    invoke: async (messageInput, options) => {
      await input?.invokeGate
      invoked.push({ input: messageInput, threadId: options?.threadId })
      return input?.invokeResult ?? true
    },
    resume: async (decision) => {
      resumedDecisions.push(decision)
      return input?.resumeResult ?? true
    }
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
            permissionMode: "explore",
            workspacePath: input?.draftWorkspacePath ?? null
          },
      goToNextThread: async () => null,
      goToPreviousThread: async () => null,
      hasPendingApproval: false,
      isBusy: false,
      setNavigationError: (error) => {
        navigationErrors.push(error)
      },
      setLocalComposerText: (value) => {
        localComposerTexts.push(value)
      },
      startFreshDraftTarget: async (draftInput) => {
        startedDrafts.push(draftInput)
      },
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
    editedMessages,
    invoked,
    localComposerTexts,
    navigationErrors,
    resumedDecisions,
    selectedModels,
    selectedPermissionModes,
    startedDrafts,
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
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller starts a workspace draft without creating an empty thread", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  const didStart = await harness.controller.startFreshDraft({
    workspacePath: "/tmp/openwork"
  })

  assert.equal(didStart, true)
  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.startedDrafts, [
    {
      modelId: "current-model",
      permissionMode: "ask-to-edit",
      workspacePath: "/tmp/openwork"
    }
  ])
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller creates workspace draft thread only when submitted", async () => {
  const harness = createControllerHarness({ draftWorkspacePath: "/tmp/openwork" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "在这个项目里开始"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [
    {
      modelId: "draft-model",
      permissionMode: "explore",
      source: AI_THREAD_SOURCE,
      title: "AI Thread",
      visibility: AI_THREAD_VISIBILITY,
      workspacePath: "/tmp/openwork"
    }
  ])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "created-thread" }])
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller rejects empty workspace draft path on submit", async () => {
  const harness = createControllerHarness({ draftWorkspacePath: "   " })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "在空路径里开始"
  }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.invoked, [])
  assert.deepEqual(harness.localComposerTexts, [])
  assert.equal(harness.navigationErrors.at(-1), "Workspace path cannot be empty.")
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
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller ignores duplicate submits while invoke is in flight", async () => {
  let releaseInvoke: () => void = () => {
    throw new Error("Invoke was not started.")
  }
  const invokeGate = new Promise<void>((resolve) => {
    releaseInvoke = resolve
  })
  const harness = createControllerHarness({ invokeGate, threadId: "existing-thread" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续"
  }

  harness.controller.runPrimaryAction(messageInput)
  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.invoked, [])
  releaseInvoke()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "existing-thread" }])
  assert.deepEqual(harness.localComposerTexts, [""])
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
  assert.deepEqual(harness.localComposerTexts, [])
})

test("launcher AI controller edits the latest user message in the selected thread", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "改成这个"
  }

  const didEdit = await harness.controller.editLastUserMessage({
    messageId: "user-1",
    messageInput
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(didEdit, true)
  assert.deepEqual(harness.editedMessages, [
    {
      input: {
        messageId: "user-1",
        messageInput
      },
      threadId: "existing-thread"
    }
  ])
  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.localComposerTexts, [])
})

test("launcher AI controller routes query writes to local composer state", () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  harness.controller.setQuery("下一句")

  assert.deepEqual(harness.localComposerTexts, ["下一句"])
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

test("launcher AI controller returns approval resume command result", async () => {
  const harness = createControllerHarness({
    resumeResult: false,
    threadId: "existing-thread"
  })

  const didResume = await harness.controller.handleApprovalDecision({ type: "approve" })

  assert.equal(didResume, false)
  assert.deepEqual(harness.resumedDecisions, [{ type: "approve" }])
})
