import assert from "node:assert/strict"
import test from "node:test"
import {
  createLauncherAiController,
  createLauncherComposerRevisionLedger,
  createLauncherCommandSubmissionGate,
  isLauncherCommandTargetCurrent,
  projectLauncherAiForkCapability,
  projectLauncherAiTargetConfiguration
} from "../../src/renderer/src/ai-core/launcher-ai-controller"
import type { AgentControl } from "../../src/renderer/src/lib/use-agent"
import type { AiCoreThreadCreateInput } from "../../src/renderer/src/ai-core/AiCoreHost"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { PermissionModeName } from "../../src/shared/permission-mode"
import type { ThreadWorkspaceKind } from "../../src/shared/thread-workspace"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../src/shared/launcher-ai"

test("launcher command acceptance stays bound to its submitted navigation target", () => {
  const submittedThread = { kind: "thread", threadId: "thread-1" } as const
  const submittedDraft = {
    kind: "draft",
    modelId: null,
    permissionMode: "ask-to-edit",
    workspaceKind: "projectless",
    workspacePath: null
  } as const

  assert.equal(
    isLauncherCommandTargetCurrent({
      acceptedThreadId: "thread-1",
      currentTarget: submittedThread,
      submittedTarget: submittedThread
    }),
    true
  )
  assert.equal(
    isLauncherCommandTargetCurrent({
      acceptedThreadId: "thread-1",
      currentTarget: { kind: "thread", threadId: "thread-1" },
      submittedTarget: submittedThread
    }),
    false
  )
  assert.equal(
    isLauncherCommandTargetCurrent({
      acceptedThreadId: "created-thread",
      currentTarget: { kind: "thread", threadId: "created-thread" },
      submittedTarget: submittedDraft
    }),
    true
  )
  assert.equal(
    isLauncherCommandTargetCurrent({
      acceptedThreadId: "created-thread",
      currentTarget: submittedDraft,
      submittedTarget: submittedDraft
    }),
    false
  )
})

test("launcher target configuration fails closed while a durable thread is hydrating", () => {
  const target = { kind: "thread", threadId: "thread-1" } as const

  assert.deepEqual(
    projectLauncherAiTargetConfiguration({
      isHydratingThread: true,
      target,
      threadConfiguration: {
        modelId: "durable-model",
        permissionMode: "auto",
        threadId: "thread-1",
        workspacePath: "/workspace"
      }
    }),
    { kind: "unavailable", reason: "thread-hydrating" }
  )
  assert.deepEqual(
    projectLauncherAiTargetConfiguration({
      isHydratingThread: false,
      target,
      threadConfiguration: null
    }),
    { kind: "unavailable", reason: "thread-state-unavailable" }
  )
})

test("launcher fork capability does not default to allowed before durable state loads", () => {
  assert.deepEqual(projectLauncherAiForkCapability({ forkState: null, isHydratingThread: false }), {
    kind: "unavailable",
    reason: "not-loaded"
  })
  assert.deepEqual(
    projectLauncherAiForkCapability({
      forkState: { canFork: true },
      isHydratingThread: true
    }),
    { kind: "unavailable", reason: "thread-hydrating" }
  )
  assert.deepEqual(
    projectLauncherAiForkCapability({
      forkState: { canFork: false, reason: "pending_hitl" },
      isHydratingThread: false
    }),
    { kind: "unavailable", reason: "pending_hitl" }
  )
})

test("launcher composer revision ledger rejects ABA-equivalent drafts", () => {
  const ledger = createLauncherComposerRevisionLedger()
  const submitted = { refs: [], text: "same text" }
  ledger.register(submitted)
  ledger.markChanged()
  ledger.markChanged()

  assert.equal(ledger.takeIfCurrent(submitted), false)

  const current = { refs: [], text: "same text" }
  ledger.register(current)
  assert.equal(ledger.takeIfCurrent(current), true)
  assert.equal(ledger.takeIfCurrent(current), false)
})

function createControllerHarness(input?: {
  commandSubmissionGate?: ReturnType<typeof createLauncherCommandSubmissionGate>
  draftWorkspaceKind?: ThreadWorkspaceKind
  draftWorkspacePath?: string | null
  invokeGate?: Promise<void>
  invokeResult?: boolean
  isBusy?: boolean
  hasPendingCommand?: boolean
  resumeGate?: Promise<void>
  resumeResult?: boolean
  threadId?: string | null
  targetUnavailable?: boolean
}): {
  acceptedInputs: Array<{ input: ComposerMessageInput; threadId: string }>
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
    workspaceKind?: ThreadWorkspaceKind
    workspacePath?: string | null
  }>
  threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }>
} {
  const acceptedInputs: Array<{ input: ComposerMessageInput; threadId: string }> = []
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
    workspaceKind?: ThreadWorkspaceKind
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
      await input?.resumeGate
      resumedDecisions.push(decision)
      return input?.resumeResult ?? true
    }
  }
  return {
    acceptedInputs,
    controller: createLauncherAiController({
      agentControl,
      branchThreadUntilMessage: async () => ({
        modelId: "model",
        threadId: "branched",
        workspacePath: "/workspace"
      }),
      commandSubmissionGate: input?.commandSubmissionGate ?? createLauncherCommandSubmissionGate(),
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
      targetConfiguration: input?.targetUnavailable
        ? { kind: "unavailable", reason: "thread-state-unavailable" }
        : input?.threadId
          ? {
              kind: "configured",
              modelId: "current-model",
              permissionMode: "ask-to-edit",
              source: "thread",
              threadId: input.threadId,
              workspacePath: "/workspace"
            }
          : {
              kind: "configured",
              modelId: "draft-model",
              permissionMode: "explore",
              source: "draft",
              workspaceKind: input?.draftWorkspaceKind ?? "projectless",
              workspacePath: input?.draftWorkspacePath ?? null
            },
      goToNextThread: async () => null,
      goToPreviousThread: async () => null,
      hasPendingCommand: input?.hasPendingCommand ?? false,
      hasPendingApproval: false,
      isBusy: input?.isBusy ?? false,
      onDidInvoke: (messageInput, threadId) => {
        acceptedInputs.push({ input: messageInput, threadId })
        localComposerTexts.push("")
      },
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
      visibility: AI_THREAD_VISIBILITY,
      workspaceKind: "projectless"
    }
  ])
  assert.deepEqual(harness.invoked, [{ input: messageInput, threadId: "created-thread" }])
  assert.deepEqual(harness.acceptedInputs, [{ input: messageInput, threadId: "created-thread" }])
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller does not submit or mutate settings without target configuration", async () => {
  const harness = createControllerHarness({
    targetUnavailable: true,
    threadId: "existing-thread"
  })
  const messageInput: ComposerMessageInput = { refs: [], text: "must not run" }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(harness.invoked, [])
  assert.deepEqual(harness.navigationErrors, [
    null,
    "Launcher target configuration is unavailable."
  ])
  assert.equal(await harness.controller.selectModel("fallback-model"), false)
  assert.equal(await harness.controller.selectPermissionMode("auto"), false)
  assert.deepEqual(harness.selectedModels, [])
  assert.deepEqual(harness.selectedPermissionModes, [])
})

test("launcher AI controller starts a workspace draft without creating an empty thread", async () => {
  const harness = createControllerHarness({ threadId: "existing-thread" })

  const didStart = await harness.controller.startFreshDraft({
    workspaceKind: "project",
    workspacePath: "/tmp/jingle"
  })

  assert.equal(didStart, true)
  assert.deepEqual(harness.createdThreads, [])
  assert.deepEqual(harness.startedDrafts, [
    {
      modelId: "current-model",
      permissionMode: "ask-to-edit",
      workspaceKind: "project",
      workspacePath: "/tmp/jingle"
    }
  ])
  assert.deepEqual(harness.localComposerTexts, [""])
})

test("launcher AI controller creates workspace draft thread only when submitted", async () => {
  const harness = createControllerHarness({
    draftWorkspaceKind: "project",
    draftWorkspacePath: "/tmp/jingle"
  })
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
      workspaceKind: "project",
      workspacePath: "/tmp/jingle"
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

test("launcher AI controller allows follow-up submit while the selected thread is running", async () => {
  const harness = createControllerHarness({ isBusy: true, threadId: "existing-thread" })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续补一条"
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

test("launcher AI controller keeps duplicate submit guard across controller recreation", async () => {
  let releaseInvoke: () => void = () => {
    throw new Error("Invoke was not started.")
  }
  const invokeGate = new Promise<void>((resolve) => {
    releaseInvoke = resolve
  })
  const commandSubmissionGate = createLauncherCommandSubmissionGate()
  const firstHarness = createControllerHarness({
    commandSubmissionGate,
    invokeGate,
    threadId: "existing-thread"
  })
  const recreatedHarness = createControllerHarness({
    commandSubmissionGate,
    threadId: "existing-thread"
  })
  const messageInput: ComposerMessageInput = {
    refs: [],
    text: "继续"
  }

  firstHarness.controller.runPrimaryAction(messageInput)
  recreatedHarness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(firstHarness.invoked, [])
  assert.deepEqual(recreatedHarness.invoked, [])

  releaseInvoke()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(firstHarness.invoked, [{ input: messageInput, threadId: "existing-thread" }])
  assert.deepEqual(recreatedHarness.invoked, [])
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

test("launcher AI controller submits one approval decision across controller recreation", async () => {
  let releaseResume: () => void = () => {
    throw new Error("Resume was not started.")
  }
  const resumeGate = new Promise<void>((resolve) => {
    releaseResume = resolve
  })
  const commandSubmissionGate = createLauncherCommandSubmissionGate()
  const firstHarness = createControllerHarness({
    commandSubmissionGate,
    resumeGate,
    threadId: "existing-thread"
  })
  const recreatedHarness = createControllerHarness({
    commandSubmissionGate,
    threadId: "existing-thread"
  })

  const approving = firstHarness.controller.handleApprovalDecision({ type: "approve" })
  const rejected = await recreatedHarness.controller.handleApprovalDecision({
    correction: "changed my mind",
    type: "corrected"
  })

  assert.equal(rejected, false)
  assert.deepEqual(firstHarness.resumedDecisions, [])
  assert.deepEqual(recreatedHarness.resumedDecisions, [])

  releaseResume()
  assert.equal(await approving, true)
  assert.deepEqual(firstHarness.resumedDecisions, [{ type: "approve" }])
  assert.deepEqual(recreatedHarness.resumedDecisions, [])
})

test("launcher AI controller blocks approval while an admitted command awaits projection", async () => {
  const harness = createControllerHarness({
    hasPendingCommand: true,
    threadId: "existing-thread"
  })

  assert.equal(
    await harness.controller.handleApprovalDecision({
      type: "user_declined"
    }),
    false
  )
  assert.deepEqual(harness.resumedDecisions, [])
})
