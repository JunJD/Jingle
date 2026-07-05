import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type {
  RuntimeApprovalControllerContract,
  RuntimeArtifactPresentationConfig,
  RuntimeArtifactPresentationContext,
  RuntimeArtifactPresentationProviderContract,
  RuntimeArtifactPresentationResult,
  RuntimeBackendContract,
  RuntimeContextRetrievalConfig as RuntimeContextRetrievalConfigBase,
  RuntimeContextRetrievalResult,
  RuntimeContextRetrievalToolContext,
  RuntimeContextRetrievalProviderContract,
  RuntimeExtensionToolsConfig,
  RuntimeExtensionToolsProviderContract,
  RuntimeCallExtensionToolContext,
  RuntimeCallExtensionToolInput,
  RuntimeExtensionToolCallUi,
  RuntimeExtensionToolContentResult,
  RuntimeExtensionToolContext,
  RuntimeExtensionToolResult,
  RuntimeExtensionToolStateUpdateResult,
  RuntimeGuardrailConfig as RuntimeGuardrailConfigBase,
  RuntimeGuardrailProviderContract,
  RuntimeGetMessageContextInput,
  RuntimeGetTraceEvidenceInput,
  RuntimeMemoryConfig as RuntimeMemoryConfigBase,
  RuntimeMemoryProviderContract,
  RuntimeModelContract,
  RuntimePauseControllerContract,
  RuntimeObservationSinkContract,
  RuntimeRunLifecycleControllerContract,
  RuntimeSearchHistoryInput,
  RuntimeSkillSourcesContract,
  RuntimeSuggestPersonalMemoryContext,
  RuntimeSuggestPersonalMemoryInput,
  RuntimeLoadExtensionToolInput,
  RuntimeTitleGeneratorContract,
  RuntimeTraceSinkContract,
  RuntimeWorkspaceFileContextConfig,
  RuntimeWorkspaceFileContextRequest,
  RuntimeWorkspaceFileContextProviderContract
} from "./runtime-contract"
import type { JingleDesktopAutomationToolHandlers } from "./desktop-automation-tools"
import type { JingleWebToolHandlers } from "./web-tools"
import type { JingleSummarizationController } from "./harness-runtime/summarization"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"

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
export type RuntimeObservationSink = RuntimeObservationSinkContract
export type RuntimeTraceSink = RuntimeTraceSinkContract
export type RuntimeSummarizationController = JingleSummarizationController
export type { RuntimeTitleGeneratorContract }
export type RuntimeTitleGenerator = RuntimeTitleGeneratorContract

export type RuntimeModuleKind =
  | "model"
  | "checkpoint"
  | "tools"
  | "context"
  | "control"
  | "observation"
  | "compaction"
  | "prompt"

export type RuntimeModuleExecutionMode =
  | "runtime-native"
  | "current-engine-middleware"
  | "current-engine-callback"
  | "external-controller"

export type RuntimeModuleStateWrite =
  | "none"
  | "checkpoint-state"
  | "product-store"
  | "external-effect"

export type RuntimeModuleSideEffect =
  | "none"
  | "model-call"
  | "checkpoint-io"
  | "tool-execution"
  | "context-lookup"
  | "approval-pause"
  | "trace-recording"
  | "summarization"
  | "prompt-assembly"

export type RuntimeModuleLegacyOwner =
  | "none"
  | "runtime-middleware-execution"
  | "runtime-middleware-state"
  | "runtime-execution-assembly"
  | "runtime-observation-capability"
  | "runtime-thread-control"

export type RuntimeModuleTargetOwner =
  | "RuntimeGraph"
  | "RuntimeModule"
  | "RuntimeObservation"
  | "RuntimeThread"

export type RuntimeModuleMigrationStatus =
  | "native"
  | "first-owner-extracted"
  | "legacy-middleware-compiled"
  | "external-controller"

export type RuntimeModuleRetirementPriority =
  | "none"
  | "early"
  | "middle"
  | "late"

export interface RuntimeModuleKindContract {
  executionMode: RuntimeModuleExecutionMode
  kind: RuntimeModuleKind
  legacyOwner: RuntimeModuleLegacyOwner
  ownsExternalDependency: boolean
  sideEffects: readonly RuntimeModuleSideEffect[]
  stateWrites: readonly RuntimeModuleStateWrite[]
}

export interface RuntimeModuleMigrationContract {
  currentOwner: RuntimeModuleLegacyOwner
  kind: RuntimeModuleKind
  middlewareCompiled: boolean
  retirementPriority: RuntimeModuleRetirementPriority
  status: RuntimeModuleMigrationStatus
  targetOwner: RuntimeModuleTargetOwner
}

export type RuntimeModuleExitStepStatus =
  | "blocked-by-runtime-native-owner"
  | "ready-for-owner-extraction"
  | "retained"

export interface RuntimeModuleExitStepContract {
  canDeleteMiddlewareWhen: string
  kind: RuntimeModuleKind
  order: number
  reason: string
  status: RuntimeModuleExitStepStatus
  stopPoint: string
  targetOwner: RuntimeModuleTargetOwner
}

export interface RuntimeModelContribution {
  model: RuntimeModelProvider
}

export interface RuntimeCheckpointContribution {
  checkpointer: BaseCheckpointSaver<string | number>
}

export interface RuntimeToolContribution {
  artifactPresentation?: RuntimeArtifactPresentationProvider
  backend?: RuntimeBackend
  desktopAutomationTools?: RuntimeDesktopAutomationTools
  extensionAiTools?: RuntimeExtensionToolsProvider
  skillSources?: RuntimeSkillSources
  webTools?: RuntimeWebTools
}

export interface RuntimeContextContribution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  contextRetrieval?: RuntimeContextRetrievalProvider<TContextInclusion>
  guardrail?: RuntimeGuardrailProvider<TGuardrailMetadata>
  memory?: RuntimeMemoryProvider<TContextInclusion>
  systemPrompt?: string
  workspaceFileContext?: RuntimeWorkspaceFileContextProvider
}

export interface RuntimeControlContribution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  approvalController?: RuntimeApprovalController
  pauseController?: RuntimePauseController<TReview>
  runLifecycleController?: RuntimeRunLifecycleController<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export interface RuntimeObservationContribution {
  trace?: RuntimeTraceSink
}

export interface RuntimeCompactionContribution {
  summarization?: RuntimeSummarizationController
}

export interface RuntimePromptContribution {
  executeToolDescription?: string
  filesystemSystemPrompt?: string
  titleGenerator?: RuntimeTitleGenerator
}

export const RUNTIME_MODULE_KIND_CONTRACTS = {
  checkpoint: {
    executionMode: "runtime-native",
    kind: "checkpoint",
    legacyOwner: "none",
    ownsExternalDependency: true,
    sideEffects: ["checkpoint-io"],
    stateWrites: ["checkpoint-state"]
  },
  compaction: {
    executionMode: "external-controller",
    kind: "compaction",
    legacyOwner: "runtime-thread-control",
    ownsExternalDependency: true,
    sideEffects: ["summarization"],
    stateWrites: ["checkpoint-state"]
  },
  context: {
    executionMode: "current-engine-middleware",
    kind: "context",
    legacyOwner: "runtime-execution-assembly",
    ownsExternalDependency: true,
    sideEffects: ["context-lookup"],
    stateWrites: ["checkpoint-state"]
  },
  control: {
    executionMode: "external-controller",
    kind: "control",
    legacyOwner: "runtime-thread-control",
    ownsExternalDependency: true,
    sideEffects: ["approval-pause"],
    stateWrites: ["checkpoint-state", "product-store"]
  },
  model: {
    executionMode: "runtime-native",
    kind: "model",
    legacyOwner: "none",
    ownsExternalDependency: true,
    sideEffects: ["model-call"],
    stateWrites: ["checkpoint-state"]
  },
  observation: {
    executionMode: "current-engine-callback",
    kind: "observation",
    legacyOwner: "runtime-observation-capability",
    ownsExternalDependency: true,
    sideEffects: ["trace-recording"],
    stateWrites: ["external-effect"]
  },
  prompt: {
    executionMode: "current-engine-middleware",
    kind: "prompt",
    legacyOwner: "runtime-execution-assembly",
    ownsExternalDependency: true,
    sideEffects: ["prompt-assembly"],
    stateWrites: ["checkpoint-state", "external-effect"]
  },
  tools: {
    executionMode: "current-engine-middleware",
    kind: "tools",
    legacyOwner: "runtime-execution-assembly",
    ownsExternalDependency: true,
    sideEffects: ["tool-execution"],
    stateWrites: ["checkpoint-state", "external-effect"]
  }
} as const satisfies Record<RuntimeModuleKind, RuntimeModuleKindContract>

export const RUNTIME_MODULE_MIGRATION_CONTRACTS = {
  checkpoint: {
    currentOwner: "none",
    kind: "checkpoint",
    middlewareCompiled: false,
    retirementPriority: "none",
    status: "native",
    targetOwner: "RuntimeGraph"
  },
  compaction: {
    currentOwner: "runtime-thread-control",
    kind: "compaction",
    middlewareCompiled: false,
    retirementPriority: "none",
    status: "external-controller",
    targetOwner: "RuntimeThread"
  },
  context: {
    currentOwner: "runtime-execution-assembly",
    kind: "context",
    middlewareCompiled: true,
    retirementPriority: "early",
    status: "legacy-middleware-compiled",
    targetOwner: "RuntimeModule"
  },
  control: {
    currentOwner: "runtime-thread-control",
    kind: "control",
    middlewareCompiled: false,
    retirementPriority: "middle",
    status: "external-controller",
    targetOwner: "RuntimeThread"
  },
  model: {
    currentOwner: "none",
    kind: "model",
    middlewareCompiled: false,
    retirementPriority: "none",
    status: "native",
    targetOwner: "RuntimeGraph"
  },
  observation: {
    currentOwner: "runtime-observation-capability",
    kind: "observation",
    middlewareCompiled: false,
    retirementPriority: "none",
    status: "first-owner-extracted",
    targetOwner: "RuntimeObservation"
  },
  prompt: {
    currentOwner: "runtime-execution-assembly",
    kind: "prompt",
    middlewareCompiled: true,
    retirementPriority: "middle",
    status: "legacy-middleware-compiled",
    targetOwner: "RuntimeModule"
  },
  tools: {
    currentOwner: "runtime-execution-assembly",
    kind: "tools",
    middlewareCompiled: true,
    retirementPriority: "late",
    status: "legacy-middleware-compiled",
    targetOwner: "RuntimeGraph"
  }
} as const satisfies Record<RuntimeModuleKind, RuntimeModuleMigrationContract>

export const RUNTIME_MODULE_EXIT_PLAN = [
  {
    canDeleteMiddlewareWhen:
      "ContextActivationNode owns memory, workspace file context, and context retrieval state updates.",
    kind: "context",
    order: 1,
    reason:
      "Context has the clearest RuntimeState boundary and should stop entering the graph as beforeModel prompt mutation.",
    status: "ready-for-owner-extraction",
    stopPoint:
      "context retrieval, memory context, and workspace file context no longer emit RuntimeExecutionMiddleware[].",
    targetOwner: "RuntimeModule"
  },
  {
    canDeleteMiddlewareWhen:
      "RuntimePrompt owns system prompt, tool descriptions, and title projection seed outside middleware hooks.",
    kind: "prompt",
    order: 2,
    reason:
      "Prompt assembly still mixes system prompt, title seed, and tool descriptions inside current engine middleware.",
    status: "blocked-by-runtime-native-owner",
    stopPoint:
      "prompt and title generation no longer write through beforeModel/afterModel middleware entries.",
    targetOwner: "RuntimeModule"
  },
  {
    canDeleteMiddlewareWhen:
      "ToolStepNode owns tool registry, tool execution, artifact updates, todos, and tool consistency repair.",
    kind: "tools",
    order: 3,
    reason:
      "Tools still carry the largest compatibility surface and should move only after context and prompt stop using middleware.",
    status: "blocked-by-runtime-native-owner",
    stopPoint:
      "filesystem, skills, web, desktop automation, artifact presentation, and extension AI tools no longer emit RuntimeExecutionMiddleware[].",
    targetOwner: "RuntimeGraph"
  }
] as const satisfies readonly RuntimeModuleExitStepContract[]

export interface RuntimeModuleContribution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  checkpoint?: RuntimeCheckpointContribution
  compaction?: RuntimeCompactionContribution
  context?: RuntimeContextContribution<TContextInclusion, TGuardrailMetadata>
  control?: RuntimeControlContribution<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  model?: RuntimeModelContribution
  observation?: RuntimeObservationContribution
  prompt?: RuntimePromptContribution
  tools?: RuntimeToolContribution
}

export type RuntimeModuleContributionForKind<
  TKind extends RuntimeModuleKind,
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> = TKind extends "model"
  ? { model: RuntimeModelContribution }
  : TKind extends "checkpoint"
    ? { checkpoint: RuntimeCheckpointContribution }
    : TKind extends "tools"
      ? { tools: RuntimeToolContribution }
      : TKind extends "context"
        ? { context: RuntimeContextContribution<TContextInclusion, TGuardrailMetadata> }
        : TKind extends "control"
          ? {
              control: RuntimeControlContribution<
                TContextInclusion,
                TReview,
                TInvokeRunLifecycleInput,
                TResumeRunLifecycleInput
              >
            }
          : TKind extends "observation"
            ? { observation: RuntimeObservationContribution }
            : TKind extends "compaction"
              ? { compaction: RuntimeCompactionContribution }
              : TKind extends "prompt"
                ? { prompt: RuntimePromptContribution }
                : never

export interface RuntimeModuleBase<
  TKind extends RuntimeModuleKind,
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  contribute(): RuntimeModuleContributionForKind<
    TKind,
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  kind: TKind
  name: string
}

export type RuntimeModule<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> = {
  [TKind in RuntimeModuleKind]: RuntimeModuleBase<
    TKind,
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}[RuntimeModuleKind]

interface AssembleRuntimeModulesInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  modules: readonly RuntimeModule<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >[]
}

export function createRuntimeObservationSink<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeObservationSinkContract | undefined {
  return input.observation?.trace ? { trace: input.observation.trace } : undefined
}

export function assembleRuntimeModules<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: AssembleRuntimeModulesInput<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeModuleContribution<
  TContextInclusion,
  TGuardrailMetadata,
  TReview,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
> {
  const contribution: RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  > = {}

  for (const runtimeModule of input.modules) {
    mergeRuntimeModuleContribution(contribution, runtimeModule.contribute())
  }

  return contribution
}

function mergeRuntimeModuleContribution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  target: RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >,
  source: RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): void {
  if (source.checkpoint) {
    mergeNestedContribution(target, "checkpoint", source.checkpoint)
  }
  if (source.compaction) {
    mergeNestedContribution(target, "compaction", source.compaction)
  }
  if (source.context) {
    mergeNestedContribution(target, "context", source.context)
  }
  if (source.control) {
    mergeNestedContribution(target, "control", source.control)
  }
  if (source.model) {
    mergeNestedContribution(target, "model", source.model)
  }
  if (source.observation) {
    mergeNestedContribution(target, "observation", source.observation)
  }
  if (source.prompt) {
    mergeNestedContribution(target, "prompt", source.prompt)
  }
  if (source.tools) {
    mergeNestedContribution(target, "tools", source.tools)
  }
}

function mergeNestedContribution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown,
  TKey extends keyof RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  > = keyof RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
>(
  target: RuntimeModuleContribution<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >,
  key: TKey,
  source: NonNullable<
    RuntimeModuleContribution<
      TContextInclusion,
      TGuardrailMetadata,
      TReview,
      TInvokeRunLifecycleInput,
      TResumeRunLifecycleInput
    >[TKey]
  >
): void {
  const existing = target[key]

  if (!existing) {
    target[key] = { ...source } as RuntimeModuleContribution<
      TContextInclusion,
      TGuardrailMetadata,
      TReview,
      TInvokeRunLifecycleInput,
      TResumeRunLifecycleInput
    >[TKey]
    return
  }

  const existingFields = existing as Record<string, unknown>
  const sourceFields = source as Record<string, unknown>

  for (const sourceKey of Object.keys(sourceFields)) {
    if (existingFields[sourceKey] !== undefined) {
      throw new Error(
        `[RuntimeModule] Duplicate contribution for ${String(key)}.${String(sourceKey)}.`
      )
    }
    existingFields[sourceKey] = sourceFields[sourceKey]
  }
}
