import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { JingleTitlePolicyState } from "./title-policy"
import type {
  HumanApprovalDecisionType,
  HumanApprovalPolicyRuntime,
  HumanApprovalRequester
} from "./human-approval-middleware"
import type { GuardrailProvider } from "./guardrail-middleware"
import type { JingleRunCompletionFacts, JingleRunCompletionStatus } from "./run-completion"
import type { RuntimeArtifactsUpdate, RuntimeRecordingRef } from "./runtime-state"
import {
  RUNTIME_CHILD_WORK_BOUNDARY,
  RUNTIME_SESSION_BOUNDARY,
  type RuntimeThreadSessionPolicy
} from "./runtime-session"
import type {
  JingleHitlReviewParser,
  JinglePendingHitlRequestUpserter
} from "./langgraph-hitl-reader"
import type { JingleLangChainTraceEvent } from "./langchain-trace-callback"
import type { JingleAgentRunTraceConfig } from "./run-config"
import type { JingleDesktopAutomationToolHandlers } from "./desktop-automation-tools"
import type { JingleWebToolHandlers } from "./web-tools"
import type { JingleFilesystemMiddlewareOptions } from "./harness-runtime/filesystem"
import type { JingleSkillsMiddlewareOptions } from "./harness-runtime/skills"
import type {
  JingleSummarizationController,
  JingleSummarizationMiddlewareOptions
} from "./harness-runtime/summarization"

export type RuntimeBackendContract = JingleFilesystemMiddlewareOptions["backend"] &
  JingleSkillsMiddlewareOptions["backend"]
export type RuntimeModelContract = JingleSummarizationMiddlewareOptions["model"]
export type RuntimeSkillSourcesContract = JingleSkillsMiddlewareOptions["sources"]

export type RuntimeWorkbenchName = "Runtime"

export interface RuntimeWorkbenchContract {
  creationAssembly: RuntimeCreationAssemblyContract
  entrypoints: Record<RuntimePackageEntrypointId, RuntimePackageEntrypointContract>
  internalOnly: readonly RuntimeInternalOnlySurface[]
  publicName: RuntimeWorkbenchName
  publicSurface: readonly RuntimePublicSurfaceCapability[]
  publicSurfaceContracts: Record<RuntimePublicSurfaceCapability, RuntimePublicSurfaceContract>
  sessionPolicy: RuntimeThreadSessionPolicy
}

export type RuntimePackageEntrypointId = "root" | "transitional"

export type RuntimePackageEntrypointName = "." | "./transitional"

export type RuntimePackageEntrypointRole =
  | "public-runtime-facade"
  | "migration-debt"

export interface RuntimePackageEntrypointContract {
  entrypoint: RuntimePackageEntrypointName
  role: RuntimePackageEntrypointRole
  targetApi: boolean
}

export type RuntimePublicSurfaceCapability =
  | "createRuntime"
  | "observation"
  | "operation"
  | "state"
  | "store"
  | "thread"

export type RuntimePublicSurfaceStability =
  | "target"
  | "transitional"

export type RuntimePublicSurfaceRole =
  | "operation-contract"
  | "public-control-surface"
  | "recoverable-state-contract"
  | "runtime-creation"
  | "store-boundary-contract"
  | "observation-boundary-contract"

export interface RuntimeCreationAssemblyContract {
  acceptedBy: "createRuntime"
  inputField: "capabilities"
  reason: string
  stability: "transitional"
  targetApi: false
}

export interface RuntimePublicSurfaceContract {
  capability: RuntimePublicSurfaceCapability
  reason: string
  role: RuntimePublicSurfaceRole
  stability: RuntimePublicSurfaceStability
  targetApi: boolean
}

export type RuntimeInternalOnlySurface =
  | "checkpoint-projection-readers"
  | "graph-engine"
  | "host-contract"
  | "jingle-named-helper-builders"
  | "legacy-middleware-segment"
  | "module-contribution"
  | "middleware-builders"
  | "runtime-execution-assembly"
  | "runtime-graph-nodes"
  | "transitional-helpers"

export type RuntimePackageSourceFile =
  | "src/index.ts"
  | "src/root-transitional-api.ts"
  | "src/runtime-public-api.ts"

export type RuntimePackageRootExportGroup =
  | RuntimePublicSurfaceCapability
  | "child-work-boundary"
  | "context-boundary"
  | "session-boundary"
  | "shell-boundary"

export interface RuntimePackageRootBoundaryContract {
  entrypoint: "."
  exportGroups: readonly RuntimePackageRootExportGroup[]
  forbiddenInternalSurfaces: readonly RuntimeInternalOnlySurface[]
  implementationFile: "src/runtime-public-api.ts"
  role: "public-runtime-facade"
  sourceFile: "src/index.ts"
  targetApi: true
  targetExportGroups: readonly RuntimePackageRootExportGroup[]
}

export interface RuntimePackageTransitionalBoundaryContract {
  entrypoint: "./transitional"
  exportGroups: readonly RuntimeInternalOnlySurface[]
  retirementCondition: string
  role: "migration-debt"
  sourceFile: "src/root-transitional-api.ts"
  targetApi: false
}

export interface RuntimePackageExportBoundaryContract {
  packageName: "@jingle/langchain-agent-harness"
  root: RuntimePackageRootBoundaryContract
  transitional: RuntimePackageTransitionalBoundaryContract
}

export const RUNTIME_WORKBENCH_CONTRACT = {
  creationAssembly: {
    acceptedBy: "createRuntime",
    inputField: "capabilities",
    reason:
      "CreateRuntimeInput.capabilities is the current package-local creation assembly input. It still uses RuntimeModule internally as a transitional bridge, but the root creation surface no longer asks callers for a module array. Flue's source model uses authored agent/tool/profile/session entities instead of making a module array the harness API, so this input must shrink or move internal as capability owners become first-class.",
    stability: "transitional",
    targetApi: false
  },
  entrypoints: {
    root: {
      entrypoint: ".",
      role: "public-runtime-facade",
      targetApi: true
    },
    transitional: {
      entrypoint: "./transitional",
      role: "migration-debt",
      targetApi: false
    }
  },
  internalOnly: [
    "checkpoint-projection-readers",
    "graph-engine",
    "host-contract",
    "jingle-named-helper-builders",
    "legacy-middleware-segment",
    "module-contribution",
    "middleware-builders",
    "runtime-execution-assembly",
    "runtime-graph-nodes",
    "transitional-helpers"
  ],
  publicName: "Runtime",
  publicSurface: [
    "createRuntime",
    "thread",
    "operation",
    "state",
    "store",
    "observation"
  ],
  publicSurfaceContracts: {
    createRuntime: {
      capability: "createRuntime",
      reason:
        "Create the runtime workbench. This remains the package root creation function.",
      role: "runtime-creation",
      stability: "target",
      targetApi: true
    },
    observation: {
      capability: "observation",
      reason:
        "Observation is a runtime event surface. It can record trace/diagnostics/projection events, but cannot route graph execution or own RuntimeState.",
      role: "observation-boundary-contract",
      stability: "target",
      targetApi: true
    },
    operation: {
      capability: "operation",
      reason:
        "RuntimeOperation is the auditable state-change input for invoke, resume, compact, and future child work.",
      role: "operation-contract",
      stability: "target",
      targetApi: true
    },
    state: {
      capability: "state",
      reason:
        "RuntimeState is the checkpointed recoverable fact schema consumed by RuntimeGraph.",
      role: "recoverable-state-contract",
      stability: "target",
      targetApi: true
    },
    store: {
      capability: "store",
      reason:
        "Store contracts separate checkpoint, product DB, and projection ownership.",
      role: "store-boundary-contract",
      stability: "target",
      targetApi: true
    },
    thread: {
      capability: "thread",
      reason:
        "RuntimeThread is the current public control surface for invoke/resume/compact and run lifecycle.",
      role: "public-control-surface",
      stability: "target",
      targetApi: true
    }
  },
  sessionPolicy: {
    childWorkStatus: RUNTIME_CHILD_WORK_BOUNDARY.status,
    publicSessionType: RUNTIME_SESSION_BOUNDARY.publicSessionType,
    publicThreadType: RUNTIME_SESSION_BOUNDARY.publicThreadType
  }
} as const satisfies RuntimeWorkbenchContract

export const RUNTIME_PACKAGE_EXPORT_BOUNDARY = {
  packageName: "@jingle/langchain-agent-harness",
  root: {
    entrypoint: ".",
    exportGroups: [
      "createRuntime",
      "thread",
      "operation",
      "state",
      "store",
      "observation",
      "context-boundary",
      "session-boundary",
      "child-work-boundary",
      "shell-boundary"
    ],
    forbiddenInternalSurfaces: RUNTIME_WORKBENCH_CONTRACT.internalOnly,
    implementationFile: "src/runtime-public-api.ts",
    role: "public-runtime-facade",
    sourceFile: "src/index.ts",
    targetApi: true,
    targetExportGroups: [
      "createRuntime",
      "thread",
      "operation",
      "state",
      "store",
      "observation",
      "context-boundary",
      "session-boundary",
      "child-work-boundary",
      "shell-boundary"
    ]
  },
  transitional: {
    entrypoint: "./transitional",
    exportGroups: [
      "checkpoint-projection-readers",
      "jingle-named-helper-builders",
      "middleware-builders",
      "transitional-helpers"
    ],
    retirementCondition: "delete when app and tests no longer import the transitional subpath",
    role: "migration-debt",
    sourceFile: "src/root-transitional-api.ts",
    targetApi: false
  }
} as const satisfies RuntimePackageExportBoundaryContract

export {
  RUNTIME_CHILD_WORK_BOUNDARY,
  RUNTIME_SESSION_BOUNDARY
} from "./runtime-session"
export type { RuntimeThreadSessionPolicy }

export interface RuntimeArtifactPresentationContext {
  runId: string | null
  toolCallId: string
}

export interface RuntimeArtifactPresentationResult {
  content: string
  update: RuntimeArtifactsUpdate
}

export interface RuntimeArtifactPresentationConfig {
  presentArtifacts: (
    input: unknown,
    context: RuntimeArtifactPresentationContext
  ) => Promise<RuntimeArtifactPresentationResult>
}

export interface RuntimeWorkspaceFileContextRequest {
  messageRefs: unknown
  messageText: string
}

export interface RuntimeWorkspaceFileContextConfig {
  resolveContext: (request: RuntimeWorkspaceFileContextRequest) => Promise<string | null>
}

export interface RuntimeGuardrailConfig<TMetadata = Record<string, unknown>> {
  applyMetadata?: (
    args: Record<string, unknown>,
    metadata: TMetadata | undefined
  ) => Record<string, unknown>
  provider: GuardrailProvider<TMetadata>
}

export interface RuntimeGetMessageContextInput {
  after?: number
  before?: number
  messageId: string
  threadId: string
}

export interface RuntimeSearchHistoryInput {
  limit?: number
  query: string
  threadId?: string
}

export interface RuntimeGetTraceEvidenceInput {
  artifactId?: string
  includeInput?: boolean
  includeOutput?: boolean
  runId?: string
  toolCallId?: string
  traceId?: string
  traceStepId?: string
}

export interface RuntimeContextRetrievalToolContext<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  existingContextInclusions: TContextInclusion[]
  runId: string
  toolCallId: string
}

export interface RuntimeContextRetrievalResult<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  content: string
  contextInclusions?: TContextInclusion[]
}

export interface RuntimeContextRetrievalConfig<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  getMessageContext: (
    input: RuntimeGetMessageContextInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
  getTraceEvidence: (
    input: RuntimeGetTraceEvidenceInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
  searchHistory: (
    input: RuntimeSearchHistoryInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
}

export interface RuntimeSuggestPersonalMemoryInput {
  content: string
  reason?: string
  scope: "global" | "workspace"
  type: "about_me" | "workspace_context" | "correction"
}

export interface RuntimeSuggestPersonalMemoryContext<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  runId: string
}

export interface RuntimeMemoryConfig<TContextInclusion = unknown> {
  applyMemoryContextToSystemPrompt?: (systemPrompt: string) => string | Promise<string>
  enableSuggestionTool: boolean
  suggestPersonalMemory: (
    input: RuntimeSuggestPersonalMemoryInput,
    context: RuntimeSuggestPersonalMemoryContext<TContextInclusion>
  ) => Promise<string>
}

export interface RuntimeLoadExtensionToolInput {
  extensionName: string
}

export interface RuntimeCallExtensionToolInput {
  args: Record<string, unknown>
  extensionName: string
  toolName: string
}

export interface RuntimeExtensionToolContext {
  runId: string | null
}

export interface RuntimeCallExtensionToolContext extends RuntimeExtensionToolContext {
  toolCallId: string | null
}

export interface RuntimeExtensionToolContentResult {
  content: unknown
}

export interface RuntimeExtensionToolStateUpdateResult {
  content: string
  stateUpdate: {
    artifacts: RuntimeArtifactsUpdate
  }
}

export type RuntimeExtensionToolResult =
  | RuntimeExtensionToolContentResult
  | RuntimeExtensionToolStateUpdateResult

export interface RuntimeExtensionToolCallUi {
  display?: unknown
  presentation?: unknown
}

export interface RuntimeExtensionToolsConfig {
  buildPromptSections: () => string[]
  callExtension: (
    input: RuntimeCallExtensionToolInput,
    context: RuntimeCallExtensionToolContext
  ) => Promise<RuntimeExtensionToolResult>
  loadExtension: (
    input: RuntimeLoadExtensionToolInput,
    context: RuntimeExtensionToolContext
  ) => Promise<RuntimeExtensionToolContentResult>
  resolveCallExtensionToolUi?: (
    input: RuntimeCallExtensionToolInput
  ) => RuntimeExtensionToolCallUi | null
}

export type RuntimeTitleGeneratorContract = (
  state: JingleTitlePolicyState
) => Promise<string | null>

export interface RuntimeThreadScope {
  threadId: string
  workspacePath: string
}

export interface RuntimeRunContextScope extends RuntimeThreadScope {
  runId: string
}

export type RuntimeArtifactPresentationProviderContract = (
  thread: RuntimeThreadScope
) => RuntimeArtifactPresentationConfig

export type RuntimeWorkspaceFileContextProviderContract = (
  thread: RuntimeThreadScope
) => RuntimeWorkspaceFileContextConfig | null | undefined

export type RuntimeGuardrailProviderContract<TMetadata = Record<string, unknown>> =
  () => RuntimeGuardrailConfig<TMetadata>

export type RuntimeContextRetrievalProviderContract<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = (
  run: RuntimeRunContextScope
) => RuntimeContextRetrievalConfig<TContextInclusion>

export type RuntimeMemoryProviderContract<TContextInclusion = unknown> = (
  run: RuntimeRunContextScope
) => RuntimeMemoryConfig<TContextInclusion>

export type RuntimeExtensionToolsProviderContract = (
  run: RuntimeRunContextScope
) => RuntimeExtensionToolsConfig

export interface RuntimeTraceRecordInput extends RuntimeRunContextScope {
  event: JingleLangChainTraceEvent
}

export interface RuntimeTraceConfigInput extends RuntimeRunContextScope {
  modelId?: string
}

export interface RuntimeRunTraceConfigInput extends RuntimeTraceConfigInput {
  source: "invoke" | "resume"
}

export interface RuntimeTraceSinkContract {
  createRunConfig?: (input: RuntimeRunTraceConfigInput) => JingleAgentRunTraceConfig
  createRuntimeConfig?: (input: RuntimeTraceConfigInput) => JingleAgentRunTraceConfig
  recordEvent(input: RuntimeTraceRecordInput): Promise<void>
  skippedRunNames?: ReadonlySet<string>
}

export interface RuntimeObservationSinkContract {
  trace?: RuntimeTraceSinkContract
}

export interface RuntimeObservationBoundaryContract {
  canRouteGraph: false
  canWriteRuntimeState: false
  deferred: readonly RuntimeObservationDeferredSurface[]
  failureSemantics: "record-and-continue"
  implemented: readonly RuntimeObservationImplementedSurface[]
  owns: readonly RuntimeObservationSurface[]
  surfaces: Record<RuntimeObservationSurface, RuntimeObservationSurfaceContract>
}

export type RuntimeObservationDeferredSurface =
  | "diagnostics"
  | "projection-event"
  | "recording"

export type RuntimeObservationImplementedSurface = "trace"

export type RuntimeObservationSurface =
  | "trace"
  | "recording"
  | "diagnostics"
  | "projection-event"

export type RuntimeObservationSurfaceOwner =
  | "RuntimeObservation"
  | "app-observation"
  | "app-projection"

export type RuntimeObservationSurfaceStatus =
  | "implemented"
  | "deferred"

export interface RuntimeObservationSurfaceContract {
  bodyStore: "productDb" | "projection" | "none"
  canRouteGraph: false
  canWriteRuntimeState: false
  owner: RuntimeObservationSurfaceOwner
  recordsRuntimeStateRefs: boolean
  status: RuntimeObservationSurfaceStatus
}

export const RUNTIME_OBSERVATION_BOUNDARY = {
  canRouteGraph: false,
  canWriteRuntimeState: false,
  deferred: ["recording", "diagnostics", "projection-event"],
  failureSemantics: "record-and-continue",
  implemented: ["trace"],
  owns: ["trace", "recording", "diagnostics", "projection-event"],
  surfaces: {
    diagnostics: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-observation",
      recordsRuntimeStateRefs: false,
      status: "deferred"
    },
    "projection-event": {
      bodyStore: "projection",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-projection",
      recordsRuntimeStateRefs: false,
      status: "deferred"
    },
    recording: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-observation",
      recordsRuntimeStateRefs: true,
      status: "deferred"
    },
    trace: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "RuntimeObservation",
      recordsRuntimeStateRefs: false,
      status: "implemented"
    }
  }
} as const satisfies RuntimeObservationBoundaryContract

export interface RuntimeCompactionControllerContract {
  summarization: JingleSummarizationController
}

export interface RuntimeApprovalControllerContract {
  allowedDecisions: readonly HumanApprovalDecisionType[]
  policyRuntime: HumanApprovalPolicyRuntime
  requestApproval?: HumanApprovalRequester
}

export interface RuntimePauseControllerContract<TReview = unknown> {
  parseReview: JingleHitlReviewParser<TReview>
  upsertPendingHitlRequest: JinglePendingHitlRequestUpserter<TReview>
}

export interface RuntimeRunLifecycleSubmittedFacts<TContextInclusion = unknown> {
  submittedContextInclusions: readonly TContextInclusion[]
  submittedRecordingRefs: readonly RuntimeRecordingRef[]
}

export interface RuntimeRunStart {
  recordingRefs: RuntimeRecordingRef[]
  runId: string
}

export interface RuntimeRunLifecycleControllerContract<
  TContextInclusion = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  beginInvokeRun: (input: {
    invoke: TInvokeRunLifecycleInput
    threadId: string
  }) => Promise<RuntimeRunStart> | RuntimeRunStart
  beginResumeRun: (input: {
    resume: TResumeRunLifecycleInput
    threadId: string
  }) => Promise<RuntimeRunStart> | RuntimeRunStart
  useCheckpointPersistence: () => boolean
  finalizeRunWithoutCheckpoint: (
    input: {
      interrupted: boolean
      runId: string
      threadId: string
    } & RuntimeRunLifecycleSubmittedFacts<TContextInclusion>
  ) =>
    | Promise<JingleRunCompletionFacts<TContextInclusion>>
    | JingleRunCompletionFacts<TContextInclusion>
  markRunAborted: (input: { runId: string; threadId: string }) => Promise<void> | void
  markRunFailed: (input: {
    error: unknown
    runId: string
    threadId: string
  }) => Promise<void> | void
  recordMemoryRecordingRefs: (input: {
    recordingRefs: readonly RuntimeRecordingRef[]
    runId: string
    threadId: string
  }) => Promise<void> | void
  recordRunFinished: (event: {
    completionReason?: string
    error?: unknown
    runId: string
    status: JingleRunCompletionStatus | "error"
    threadId: string
  }) => Promise<void> | void
  recordRunInterrupted: (event: {
    runId: string
    status: "interrupted"
    threadId: string
  }) => Promise<void> | void
  syncRunFromLatestCheckpoint: (
    input: {
      expectedMessageId?: string
      interrupted: boolean
      runId: string
      threadId: string
    } & RuntimeRunLifecycleSubmittedFacts<TContextInclusion>
  ) =>
    | Promise<JingleRunCompletionFacts<TContextInclusion>>
    | JingleRunCompletionFacts<TContextInclusion>
}

export interface RuntimeExecutionHostContract {
  model: RuntimeModelContract
  systemPrompt: string
}

export interface RuntimeCheckpointHostContract {
  checkpointer: BaseCheckpointSaver<string | number>
}

export interface RuntimeEnvironmentHostContract {
  artifactPresentation: RuntimeArtifactPresentationProviderContract
  backend: RuntimeBackendContract
  desktopAutomationTools: JingleDesktopAutomationToolHandlers
  executeToolDescription: string
  extensionAiTools: RuntimeExtensionToolsProviderContract
  filesystemSystemPrompt: string
  skillSources: RuntimeSkillSourcesContract
  webTools: JingleWebToolHandlers
}

export interface RuntimeContextHostContract<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  contextRetrieval: RuntimeContextRetrievalProviderContract<TContextInclusion>
  guardrail: RuntimeGuardrailProviderContract<TGuardrailMetadata>
  memory?: RuntimeMemoryProviderContract<TContextInclusion>
  titleGenerator: RuntimeTitleGeneratorContract
  workspaceFileContext?: RuntimeWorkspaceFileContextProviderContract
}

export interface RuntimeControlHostContract<
  TContextInclusion = unknown,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  approvalController: RuntimeApprovalControllerContract
  compaction: RuntimeCompactionControllerContract
  pauseController: RuntimePauseControllerContract<TReview>
  runLifecycleController: RuntimeRunLifecycleControllerContract<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export interface RuntimeObservationHostContract {
  sink?: RuntimeObservationSinkContract
}

export interface RuntimeHostContract<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  context: RuntimeContextHostContract<TContextInclusion, TGuardrailMetadata>
  control: RuntimeControlHostContract<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  checkpoint: RuntimeCheckpointHostContract
  environment: RuntimeEnvironmentHostContract
  execution: RuntimeExecutionHostContract
  observation: RuntimeObservationHostContract
}

export interface CreateRuntimeThreadFactoryInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  host: RuntimeHostContract<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}
