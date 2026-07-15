import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type { JingleTitlePolicyState } from "./title-policy"
import type {
  HumanApprovalDecisionType,
  HumanApprovalPolicyRuntime,
  HumanApprovalRequester
} from "./human-approval-middleware"
import type { GuardrailProvider } from "./guardrail-middleware"
import type { JingleRunCompletionFacts, JingleRunCompletionStatus } from "./run-completion"
import type { RuntimeRecordingRef } from "./runtime-state"
import type {
  JingleHitlReviewParser,
  JinglePendingHitlRequestUpserter
} from "./langgraph-hitl-reader"
import type { JingleDesktopAutomationToolHandlers } from "./desktop-automation-tools"
import type { JingleWebToolHandlers } from "./web-tools"
import type { JingleFilesystemMiddlewareOptions } from "./harness-runtime/filesystem"
import type { JingleSkillsMiddlewareOptions } from "./harness-runtime/skills"
import type {
  JingleSummarizationController,
  JingleSummarizationMiddlewareOptions
} from "./harness-runtime/summarization"
import type { RuntimeObservationSinkContract } from "./runtime-observation"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type {
  RuntimeContextRetrievalProviderContract,
  RuntimeMemoryProviderContract,
  RuntimeWorkspaceFileContextProviderContract
} from "./runtime-context"
import type {
  RuntimeArtifactPresentationProviderContract,
  RuntimeExtensionToolsProviderContract
} from "./runtime-tools"
import type { RuntimeRunCapabilityScope, RuntimeThreadScope } from "./runtime-scope"

export type RuntimeBackendContract = JingleFilesystemMiddlewareOptions["backend"] &
  JingleSkillsMiddlewareOptions["backend"]
export type RuntimeModelContract = JingleSummarizationMiddlewareOptions["model"]
export type RuntimeSkillSourcesContract = JingleSkillsMiddlewareOptions["sources"]

export interface RuntimeResourceResolutionContext {
  /** Capability resolution belongs to the active run and must stop when this signal aborts. */
  signal: AbortSignal
}

export type RuntimeModelProviderFactory = (
  scope: RuntimeRunCapabilityScope,
  context: RuntimeResourceResolutionContext
) => RuntimeModelContract

/** Checkpointers are manager-owned; the provider must make only this run's wait abortable. */
export type RuntimeCheckpointProvider = (
  scope: RuntimeThreadScope,
  context: RuntimeResourceResolutionContext
) => BaseCheckpointSaver<string | number> | Promise<BaseCheckpointSaver<string | number>>

export type RuntimeBackendProvider = (
  scope: RuntimeThreadScope,
  context: RuntimeResourceResolutionContext
) => RuntimeBackendContract

export type RuntimeSystemPromptProvider = (scope: RuntimeThreadScope) => string

export type RuntimeSkillSourcesProvider = (scope: RuntimeThreadScope) => RuntimeSkillSourcesContract

export type RuntimePromptTextProvider = (scope: RuntimeThreadScope) => string

export type RuntimeApprovalControllerProvider = (
  scope: RuntimeRunCapabilityScope,
  context: RuntimeResourceResolutionContext
) => RuntimeApprovalControllerContract

export type RuntimeCompactionControllerProvider = (
  scope: RuntimeRunCapabilityScope,
  context: RuntimeResourceResolutionContext
) => JingleSummarizationController

export interface RuntimeGuardrailConfig<TMetadata = Record<string, unknown>> {
  applyMetadata?: (
    args: Record<string, unknown>,
    metadata: TMetadata | undefined
  ) => Record<string, unknown>
  provider: GuardrailProvider<TMetadata>
}

export type RuntimeTitleGeneratorContract = (
  state: JingleTitlePolicyState
) => Promise<string | null>

export type RuntimeGuardrailProviderContract<TMetadata = Record<string, unknown>> = (
  scope: RuntimeThreadScope
) => RuntimeGuardrailConfig<TMetadata>

export interface RuntimeCompactionControllerContract {
  summarization: RuntimeCompactionControllerProvider
}

export interface RuntimeResolvedCompactionControllerContract {
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
  modelId: string
  recordingRefs: RuntimeRecordingRef[]
  runId: string
}

export interface RuntimeResumeRunStart extends RuntimeRunStart {
  beforePendingHitlPersistence: () => Promise<void> | void
}

export interface RuntimeRunLifecycleControllerContract<
  TContextInclusion = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  /** Returns the durable start fact; the controller must compensate before rejecting after commit. */
  beginInvokeRun: (input: {
    invoke: TInvokeRunLifecycleInput
    threadId: string
  }) => Promise<RuntimeRunStart> | RuntimeRunStart
  /** Returns the durable resume fact; the controller must compensate before rejecting after commit. */
  beginResumeRun: (input: {
    resume: TResumeRunLifecycleInput
    threadId: string
  }) => Promise<RuntimeResumeRunStart> | RuntimeResumeRunStart
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
  settleRun: (input: { runId: string; threadId: string }) => Promise<void> | void
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
  model: RuntimeModelProviderFactory
  systemPrompt: RuntimeSystemPromptProvider
}

export interface RuntimeResolvedExecutionHostContract {
  model: RuntimeModelContract
  systemPrompt: string
}

export interface RuntimeCheckpointHostContract {
  checkpointer: RuntimeCheckpointProvider
}

export interface RuntimeResolvedCheckpointHostContract {
  checkpointer: BaseCheckpointSaver<string | number>
}

export interface RuntimeEnvironmentHostContract {
  artifactPresentation: RuntimeArtifactPresentationProviderContract
  backend: RuntimeBackendProvider
  desktopAutomationTools: JingleDesktopAutomationToolHandlers
  executeToolDescription: RuntimePromptTextProvider
  extensionAiTools: RuntimeExtensionToolsProviderContract
  filesystemSystemPrompt: RuntimePromptTextProvider
  skillSources: RuntimeSkillSourcesProvider
  webTools: JingleWebToolHandlers
}

export interface RuntimeResolvedEnvironmentHostContract {
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
  approvalController: RuntimeApprovalControllerProvider
  compaction: RuntimeCompactionControllerContract
  pauseController: RuntimePauseControllerContract<TReview>
  runLifecycleController: RuntimeRunLifecycleControllerContract<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export interface RuntimeResolvedControlHostContract<
  TContextInclusion = unknown,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  approvalController: RuntimeApprovalControllerContract
  compaction: RuntimeResolvedCompactionControllerContract
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

export interface RuntimeResolvedHostContract<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  context: RuntimeContextHostContract<TContextInclusion, TGuardrailMetadata>
  control: RuntimeResolvedControlHostContract<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  checkpoint: RuntimeResolvedCheckpointHostContract
  environment: RuntimeResolvedEnvironmentHostContract
  execution: RuntimeResolvedExecutionHostContract
  observation: RuntimeObservationHostContract
}
