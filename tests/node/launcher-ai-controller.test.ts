import assert from "node:assert/strict"
import test from "node:test"
import {
  createLauncherAiController,
  createLauncherComposerRevisionLedger,
  createLauncherCommandSubmissionGate,
  canSubmitLauncherApprovalDecision,
  canSelectLauncherAiModel,
  clearLauncherApprovalCorrectionDraft,
  clearLauncherApprovalModelRecoveryDraft,
  createLauncherApprovalCorrectionKey,
  createLauncherApprovalModelRecoveryKey,
  isLauncherCommandTargetCurrent,
  getLauncherApprovalCorrectionDraft,
  projectLauncherApprovalActions,
  projectLauncherApprovalModelRecovery,
  projectLauncherAiForkCapability,
  projectLauncherAiTargetConfiguration,
  setLauncherApprovalCorrectionDraft,
  setLauncherApprovalModelRecoveryDraft
} from "../../src/renderer/src/ai-core/launcher-ai-controller"
import type { AgentControl } from "../../src/renderer/src/lib/use-agent"
import type { AiCoreThreadCreateInput } from "../../src/renderer/src/ai-core/AiCoreHost"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { PermissionModeName } from "../../src/shared/permission-mode"
import type { ThreadWorkspaceKind } from "../../src/shared/thread-workspace"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../src/shared/launcher-ai"
import type { HITLRequest } from "../../src/shared/hitl"
import type { ModelRuntimeSelection } from "../../src/shared/app-types"
import {
  createPendingModelSelection,
  resolvePendingModelId
} from "../../src/renderer/src/features/model-selection/model-selection-projection"

function runtimeSelection(
  modelId: string,
  thinkingEffort: ModelRuntimeSelection["thinkingEffort"] = null
): ModelRuntimeSelection {
  return { modelId, thinkingEffort, version: 1 }
}

function createApprovalRequest(review: HITLRequest["review"]): HITLRequest {
  return {
    allowed_decisions: ["approve", "user_declined", "corrected"],
    id: "approval-1",
    review,
    tool_call: {
      args: { command: "echo ready" },
      id: "tool-call-1",
      name: "execute"
    }
  }
}

test("launcher approval actions fail closed without a typed review", () => {
  const request = createApprovalRequest(null)

  assert.deepEqual(projectLauncherApprovalActions(request), {
    canApprove: false,
    canCorrect: false,
    canDeclineRun: true,
    hasValidReview: false
  })
  assert.equal(canSubmitLauncherApprovalDecision(request, { type: "approve" }), false)
  assert.equal(
    canSubmitLauncherApprovalDecision(request, {
      correction: "use a safer command",
      type: "corrected"
    }),
    false
  )
  assert.equal(canSubmitLauncherApprovalDecision(request, { type: "user_declined" }), true)
})

test("launcher approval actions follow typed review and allowed decisions", () => {
  const request = createApprovalRequest({
    changes: [],
    command: "echo ready",
    kind: "execute_command",
    predictionStatus: null,
    profile: "read_only",
    reason: null,
    toolName: "execute"
  })
  request.allowed_decisions = ["approve", "corrected"]

  assert.deepEqual(projectLauncherApprovalActions(request), {
    canApprove: true,
    canCorrect: true,
    canDeclineRun: false,
    hasValidReview: true
  })
  assert.equal(canSubmitLauncherApprovalDecision(request, { type: "approve" }), true)
  assert.equal(
    canSubmitLauncherApprovalDecision(request, { correction: "  ", type: "corrected" }),
    false
  )
  assert.equal(
    canSubmitLauncherApprovalDecision(request, {
      correction: "use a safer command",
      type: "corrected"
    }),
    true
  )
  assert.equal(canSubmitLauncherApprovalDecision(request, { type: "user_declined" }), false)
})

test("launcher approval correction drafts stay isolated by thread and request identity", () => {
  const threadARequestA = createLauncherApprovalCorrectionKey("thread-a", "approval-a")
  const threadARequestB = createLauncherApprovalCorrectionKey("thread-a", "approval-b")
  const threadBRequestA = createLauncherApprovalCorrectionKey("thread-b", "approval-a")
  let drafts: ReadonlyMap<string, string> = new Map()

  drafts = setLauncherApprovalCorrectionDraft(drafts, threadARequestA, "correction A")
  drafts = setLauncherApprovalCorrectionDraft(drafts, threadARequestB, "correction B")
  drafts = setLauncherApprovalCorrectionDraft(drafts, threadBRequestA, "correction C")

  assert.equal(getLauncherApprovalCorrectionDraft(drafts, threadARequestA), "correction A")
  assert.equal(getLauncherApprovalCorrectionDraft(drafts, threadARequestB), "correction B")
  assert.equal(getLauncherApprovalCorrectionDraft(drafts, threadBRequestA), "correction C")
  assert.equal(getLauncherApprovalCorrectionDraft(drafts, null), "")
})

test("launcher clears only the submitted approval correction draft", () => {
  const submittedKey = createLauncherApprovalCorrectionKey("thread-a", "approval-a")
  const currentKey = createLauncherApprovalCorrectionKey("thread-b", "approval-b")
  let drafts: ReadonlyMap<string, string> = new Map()
  drafts = setLauncherApprovalCorrectionDraft(drafts, submittedKey, "submitted correction")
  drafts = setLauncherApprovalCorrectionDraft(drafts, currentKey, "current correction")

  const cleared = clearLauncherApprovalCorrectionDraft(drafts, submittedKey)
  assert.equal(getLauncherApprovalCorrectionDraft(cleared, submittedKey), "")
  assert.equal(getLauncherApprovalCorrectionDraft(cleared, currentKey), "current correction")
  assert.equal(clearLauncherApprovalCorrectionDraft(cleared, submittedKey), cleared)
})

test("launcher binds legacy run recovery to the exact approval and original model", () => {
  const pendingApproval = createApprovalRequest({
    changes: [],
    command: "echo ready",
    kind: "execute_command",
    predictionStatus: null,
    profile: "read_only",
    reason: null,
    toolName: "execute"
  })
  const recovery = {
    kind: "legacy_missing_effort" as const,
    modelId: "deepseek:deepseek-v4-pro",
    requestId: pendingApproval.id,
    runId: "run-legacy",
    toolCallId: pendingApproval.tool_call.id
  }
  const catalog = {
    contractIssueCount: 0,
    defaultModelId: null,
    defaultSelection: null,
    models: [
      {
        id: recovery.modelId,
        modelCode: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        providerId: "deepseek" as const,
        reasoningEfforts: ["off", "high", "max"] as const,
        status: "active" as const
      }
    ],
    providers: [
      {
        availability: { kind: "ready" as const },
        id: "deepseek" as const,
        name: "DeepSeek"
      }
    ]
  }
  const key = createLauncherApprovalModelRecoveryKey({
    requestId: recovery.requestId,
    runId: recovery.runId,
    threadId: "thread-1"
  })
  let drafts: ReadonlyMap<string, ModelRuntimeSelection> = new Map()

  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog,
      drafts,
      loadState: "ready",
      pendingApproval,
      recovery,
      threadId: "thread-1"
    }),
    {
      allowedValues: ["off", "high", "max"],
      kind: "required",
      modelId: recovery.modelId,
      modelName: "DeepSeek V4 Pro",
      selection: null
    }
  )

  const selection = runtimeSelection(recovery.modelId, "max")
  drafts = setLauncherApprovalModelRecoveryDraft(drafts, key, selection)
  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog,
      drafts,
      loadState: "ready",
      pendingApproval,
      recovery,
      threadId: "thread-1"
    }),
    {
      allowedValues: ["off", "high", "max"],
      kind: "required",
      modelId: recovery.modelId,
      modelName: "DeepSeek V4 Pro",
      selection
    }
  )
  assert.equal(clearLauncherApprovalModelRecoveryDraft(drafts, key).has(key), false)

  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog,
      drafts,
      loadState: "ready",
      pendingApproval: { ...pendingApproval, id: "approval-replaced" },
      recovery,
      threadId: "thread-1"
    }),
    { kind: "not_required" }
  )
  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog,
      drafts,
      loadState: "ready",
      pendingApproval,
      recovery: {
        kind: "invalid",
        requestId: recovery.requestId,
        runId: recovery.runId,
        toolCallId: recovery.toolCallId
      },
      threadId: "thread-1"
    }),
    { kind: "blocked", reason: "invalid" }
  )
  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog,
      drafts,
      loadState: "ready",
      pendingApproval,
      recovery: {
        kind: "source_run_unavailable",
        requestId: recovery.requestId,
        runId: recovery.runId,
        toolCallId: recovery.toolCallId
      },
      threadId: "thread-1"
    }),
    { kind: "blocked", reason: "source_run_unavailable" }
  )
})

test("launcher keeps decline available while legacy model recovery is blocked", () => {
  const request = createApprovalRequest({
    changes: [],
    command: "echo ready",
    kind: "execute_command",
    predictionStatus: null,
    profile: "read_only",
    reason: null,
    toolName: "execute"
  })
  assert.equal(canSubmitLauncherApprovalDecision(request, { type: "user_declined" }), true)
  assert.deepEqual(
    projectLauncherApprovalModelRecovery({
      catalog: {
        contractIssueCount: 0,
        defaultModelId: null,
        defaultSelection: null,
        models: [],
        providers: []
      },
      drafts: new Map(),
      loadState: "ready",
      pendingApproval: request,
      recovery: {
        kind: "legacy_missing_effort",
        modelId: "deepseek:deepseek-v4-pro",
        requestId: request.id,
        runId: "run-legacy",
        toolCallId: request.tool_call.id
      },
      threadId: "thread-1"
    }),
    { kind: "blocked", reason: "model_unavailable" }
  )
})

test("launcher command acceptance stays bound to its submitted navigation target", () => {
  const submittedThread = { kind: "thread", threadId: "thread-1" } as const
  const submittedDraft = {
    kind: "draft",
    modelRuntimeSelection: null,
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
        modelRuntimeSelection: {
          kind: "ready",
          selection: runtimeSelection("durable-model", "high")
        },
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

test("launcher exposes model reselection while a durable selection requires recovery", () => {
  const target = { kind: "thread", threadId: "thread-legacy" } as const
  for (const modelRuntimeSelection of [
    { kind: "legacy_missing_effort", modelId: "openai:gpt-5" } as const,
    { kind: "invalid" } as const,
    { kind: "missing" } as const
  ]) {
    const projection = projectLauncherAiTargetConfiguration({
      isHydratingThread: false,
      target,
      threadConfiguration: {
        modelRuntimeSelection,
        permissionMode: "ask-to-edit",
        threadId: "thread-legacy",
        workspacePath: "/workspace"
      }
    })
    assert.deepEqual(projection, {
      kind: "model-selection-required",
      modelRuntimeSelectionState: modelRuntimeSelection,
      permissionMode: "ask-to-edit",
      source: "thread",
      threadId: "thread-legacy",
      workspacePath: "/workspace"
    })
    assert.equal(canSelectLauncherAiModel(projection), true)
  }
})

test("external model selection revisions invalidate stale picker drafts", () => {
  const currentSelection = runtimeSelection("deepseek:deepseek-v4-pro", "high")
  const pendingSelection = createPendingModelSelection({
    currentSelection,
    modelId: "openai:gpt-5.6-sol",
    selectionRevision: 3
  })
  assert.equal(
    resolvePendingModelId({ currentSelection, pendingSelection, selectionRevision: 3 }),
    "openai:gpt-5.6-sol"
  )
  assert.equal(
    resolvePendingModelId({ currentSelection, pendingSelection, selectionRevision: 4 }),
    "deepseek:deepseek-v4-pro"
  )
  assert.equal(
    resolvePendingModelId({
      currentSelection: { ...currentSelection, thinkingEffort: "max" },
      pendingSelection,
      selectionRevision: 3
    }),
    "deepseek:deepseek-v4-pro"
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
  targetSelectionRequired?: boolean
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
  selectedModels: ModelRuntimeSelection[]
  selectedPermissionModes: PermissionModeName[]
  startedDrafts: Array<{
    modelRuntimeSelection: ModelRuntimeSelection | null
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
  const selectedModels: ModelRuntimeSelection[] = []
  const selectedPermissionModes: PermissionModeName[] = []
  const startedDrafts: Array<{
    modelRuntimeSelection: ModelRuntimeSelection | null
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
          modelId: createInput.modelRuntimeSelection?.modelId ?? "default-model",
          threadId: "created-thread",
          workspacePath: "/workspace"
        }
      },
      targetConfiguration: input?.targetUnavailable
        ? { kind: "unavailable", reason: "thread-state-unavailable" }
        : input?.targetSelectionRequired
          ? {
              kind: "model-selection-required",
              modelRuntimeSelectionState: { kind: "legacy_missing_effort", modelId: "legacy" },
              permissionMode: "ask-to-edit",
              source: "thread",
              threadId: input.threadId ?? "existing-thread",
              workspacePath: "/workspace"
            }
          : input?.threadId
            ? {
                kind: "configured",
                modelRuntimeSelection: runtimeSelection("current-model", "high"),
                permissionMode: "ask-to-edit",
                source: "thread",
                threadId: input.threadId,
                workspacePath: "/workspace"
              }
            : {
                kind: "configured",
                modelRuntimeSelection: runtimeSelection("draft-model", "low"),
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
        selectedModels.push(commandInput.selection)
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
      modelRuntimeSelection: runtimeSelection("draft-model", "low"),
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
  assert.equal(
    await harness.controller.selectModel(runtimeSelection("fallback-model", "high")),
    false
  )
  assert.equal(await harness.controller.selectPermissionMode("auto"), false)
  assert.deepEqual(harness.selectedModels, [])
  assert.deepEqual(harness.selectedPermissionModes, [])
})

test("launcher AI controller only permits model reselection during durable selection recovery", async () => {
  const harness = createControllerHarness({
    targetSelectionRequired: true,
    threadId: "existing-thread"
  })
  const messageInput: ComposerMessageInput = { refs: [], text: "must wait for reselection" }

  harness.controller.runPrimaryAction(messageInput)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(
    await harness.controller.selectModel(runtimeSelection("recovered-model", "high")),
    true
  )
  assert.equal(await harness.controller.selectPermissionMode("auto"), false)
  assert.equal(await harness.controller.startFreshDraft(), false)
  assert.equal(
    await harness.controller.editLastUserMessage({ messageId: "user-1", messageInput }),
    false
  )
  assert.deepEqual(harness.selectedModels, [runtimeSelection("recovered-model", "high")])
  assert.deepEqual(harness.invoked, [])
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
      modelRuntimeSelection: runtimeSelection("current-model", "high"),
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
      modelRuntimeSelection: runtimeSelection("draft-model", "low"),
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

  const didSelectModel = await harness.controller.selectModel(runtimeSelection("model-b", "max"))
  const didSelectPermissionMode = await harness.controller.selectPermissionMode("auto")

  assert.equal(didSelectModel, true)
  assert.equal(didSelectPermissionMode, true)
  assert.deepEqual(harness.selectedModels, [runtimeSelection("model-b", "max")])
  assert.deepEqual(harness.selectedPermissionModes, ["auto"])
  assert.deepEqual(harness.threadUpdates, [
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
