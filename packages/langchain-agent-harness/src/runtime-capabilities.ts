import type {
  RuntimeApprovalControllerContract,
  RuntimeApprovalControllerProvider,
  RuntimeBackendContract,
  RuntimeBackendProvider,
  RuntimeCheckpointProvider,
  RuntimeCompactionControllerProvider,
  RuntimeGuardrailConfig as RuntimeGuardrailConfigBase,
  RuntimeGuardrailProviderContract,
  RuntimeModelContract,
  RuntimeModelProviderFactory,
  RuntimePauseControllerContract,
  RuntimePromptTextProvider,
  RuntimeRunLifecycleControllerContract,
  RuntimeSkillSourcesContract,
  RuntimeSkillSourcesProvider,
  RuntimeSystemPromptProvider,
  RuntimeTitleGeneratorContract
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type {
  RuntimeContextRetrievalConfig as RuntimeContextRetrievalConfigBase,
  RuntimeContextRetrievalProviderContract,
  RuntimeContextRetrievalResult,
  RuntimeContextRetrievalToolContext,
  RuntimeGetMessageContextInput,
  RuntimeGetTraceEvidenceInput,
  RuntimeMemoryConfig as RuntimeMemoryConfigBase,
  RuntimeMemoryProviderContract,
  RuntimeSearchHistoryInput,
  RuntimeSuggestPersonalMemoryContext,
  RuntimeSuggestPersonalMemoryInput,
  RuntimeWorkspaceFileContextConfig,
  RuntimeWorkspaceFileContextProviderContract,
  RuntimeWorkspaceFileContextRequest
} from "./runtime-context"
import type { JingleDesktopAutomationToolHandlers } from "./desktop-automation-tools"
import type { JingleSummarizationController } from "./harness-runtime/summarization"
import type {
  RuntimeObservationCapabilities
} from "./runtime-observation"
import type {
  RuntimeArtifactPresentationConfig,
  RuntimeArtifactPresentationContext,
  RuntimeArtifactPresentationProviderContract,
  RuntimeArtifactPresentationResult,
  RuntimeCallExtensionToolContext,
  RuntimeCallExtensionToolInput,
  RuntimeExtensionToolCallUi,
  RuntimeExtensionToolContentResult,
  RuntimeExtensionToolContext,
  RuntimeExtensionToolResult,
  RuntimeExtensionToolStateUpdateResult,
  RuntimeExtensionToolsConfig,
  RuntimeExtensionToolsProviderContract,
  RuntimeLoadExtensionToolInput
} from "./runtime-tools"
import type { JingleWebToolHandlers } from "./web-tools"

export type RuntimeModelProvider = RuntimeModelContract
export type RuntimeBackend = RuntimeBackendContract
export type RuntimeSkillSources = RuntimeSkillSourcesContract
export type { RuntimeArtifactPresentationConfig }
export type { RuntimeArtifactPresentationContext }
export type { RuntimeArtifactPresentationResult }
export type RuntimeContextRetrievalProvider<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeContextRetrievalProviderContract<TContextInclusion>
export type RuntimeContextRetrievalConfig<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeContextRetrievalConfigBase<TContextInclusion>
export type { RuntimeContextRetrievalResult }
export type { RuntimeContextRetrievalToolContext }
export type { RuntimeGetMessageContextInput }
export type { RuntimeGetTraceEvidenceInput }
export type { RuntimeSearchHistoryInput }
export type RuntimeMemoryProvider<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeMemoryProviderContract<TContextInclusion>
export type RuntimeMemoryConfig<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeMemoryConfigBase<TContextInclusion>
export type { RuntimeSuggestPersonalMemoryContext }
export type { RuntimeSuggestPersonalMemoryInput }
export type { RuntimeWorkspaceFileContextConfig }
export type { RuntimeWorkspaceFileContextRequest }
export type RuntimeWorkspaceFileContextProvider = RuntimeWorkspaceFileContextProviderContract
export type RuntimeGuardrailProvider<TGuardrailMetadata = Record<string, unknown>> =
  RuntimeGuardrailProviderContract<TGuardrailMetadata>
export type RuntimeGuardrailConfig<TGuardrailMetadata = Record<string, unknown>> =
  RuntimeGuardrailConfigBase<TGuardrailMetadata>
export type { RuntimeExtensionToolsConfig }
export type { RuntimeCallExtensionToolContext }
export type { RuntimeCallExtensionToolInput }
export type { RuntimeExtensionToolCallUi }
export type { RuntimeExtensionToolContentResult }
export type { RuntimeExtensionToolContext }
export type { RuntimeExtensionToolResult }
export type { RuntimeExtensionToolStateUpdateResult }
export type { RuntimeLoadExtensionToolInput }
export type RuntimeExtensionToolsProvider = RuntimeExtensionToolsProviderContract
export type RuntimeArtifactPresentationProvider = RuntimeArtifactPresentationProviderContract
export type RuntimeDesktopAutomationTools = JingleDesktopAutomationToolHandlers
export type RuntimeWebTools = JingleWebToolHandlers
export type RuntimeApprovalController = RuntimeApprovalControllerContract
export type RuntimePauseController<TReview = unknown> = RuntimePauseControllerContract<TReview>
export type RuntimeRunLifecycleController<
  TContextInclusion = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> = RuntimeRunLifecycleControllerContract<
  TContextInclusion,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
>
export type RuntimeSummarizationController = JingleSummarizationController
export type { RuntimeTitleGeneratorContract }
export type RuntimeTitleGenerator = RuntimeTitleGeneratorContract

export interface RuntimeModelCapability {
  model: RuntimeModelProviderFactory
}

export interface RuntimeCheckpointCapability {
  checkpointer: RuntimeCheckpointProvider
}

export interface RuntimeToolCapabilities {
  artifactPresentation?: RuntimeArtifactPresentationProvider
  backend?: RuntimeBackendProvider
  desktopAutomationTools?: RuntimeDesktopAutomationTools
  extensionAiTools?: RuntimeExtensionToolsProvider
  skillSources?: RuntimeSkillSourcesProvider
  webTools?: RuntimeWebTools
}

export interface RuntimeContextCapabilities<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  contextRetrieval?: RuntimeContextRetrievalProvider<TContextInclusion>
  guardrail?: RuntimeGuardrailProvider<TGuardrailMetadata>
  memory?: RuntimeMemoryProvider<TContextInclusion>
  systemPrompt?: RuntimeSystemPromptProvider
  workspaceFileContext?: RuntimeWorkspaceFileContextProvider
}

export interface RuntimeControlCapabilities<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  approvalController?: RuntimeApprovalControllerProvider
  pauseController?: RuntimePauseController<TReview>
  runLifecycleController?: RuntimeRunLifecycleController<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export interface RuntimeCompactionCapabilities {
  summarization?: RuntimeCompactionControllerProvider
}

export interface RuntimePromptCapabilities {
  executeToolDescription?: RuntimePromptTextProvider
  filesystemSystemPrompt?: RuntimePromptTextProvider
  titleGenerator?: RuntimeTitleGenerator
}

export interface RuntimeCapabilities<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  checkpoint?: RuntimeCheckpointCapability
  compaction?: RuntimeCompactionCapabilities
  context?: RuntimeContextCapabilities<TContextInclusion, TGuardrailMetadata>
  control?: RuntimeControlCapabilities<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  model?: RuntimeModelCapability
  observation?: RuntimeObservationCapabilities
  prompt?: RuntimePromptCapabilities
  tools?: RuntimeToolCapabilities
}
