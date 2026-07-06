import { createRuntimeThreadFactory } from "./runtime-thread-factory"
import type { RuntimeHostContract } from "./runtime-contract"
import type { RuntimeThread, RuntimeThreadInput } from "./runtime-thread"
import type { RuntimeCapabilities } from "./runtime-capabilities"
import { createRuntimeObservationSink } from "./runtime-observation"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"

export interface Runtime<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  thread(
    input: RuntimeThreadInput
  ): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
}

export interface CreateRuntimeInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  capabilities: RuntimeCapabilities<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export function createRuntime<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: CreateRuntimeInput<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): Runtime<
  TContextInclusion,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
> {
  const threadFactory = createRuntimeThreadFactory({
    host: createRuntimeHost<
      TContextInclusion,
      TGuardrailMetadata,
      TReview,
      TInvokeRunLifecycleInput,
      TResumeRunLifecycleInput
    >(input.capabilities)
  })

  return {
    thread(threadInput) {
      return threadFactory.thread(threadInput)
    }
  }
}

function createRuntimeHost<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  contribution: RuntimeCapabilities<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeHostContract<
  TContextInclusion,
  TGuardrailMetadata,
  TReview,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
> {
  const execution = {
    model: requireRuntimeContribution(contribution.model?.model, "model.model"),
    systemPrompt: requireRuntimeContribution(
      contribution.context?.systemPrompt,
      "context.systemPrompt"
    )
  }
  const checkpoint = {
    checkpointer: requireRuntimeContribution(
      contribution.checkpoint?.checkpointer,
      "checkpoint.checkpointer"
    )
  }
  const environment = {
    artifactPresentation: requireRuntimeContribution(
      contribution.tools?.artifactPresentation,
      "tools.artifactPresentation"
    ),
    backend: requireRuntimeContribution(contribution.tools?.backend, "tools.backend"),
    desktopAutomationTools: requireRuntimeContribution(
      contribution.tools?.desktopAutomationTools,
      "tools.desktopAutomationTools"
    ),
    executeToolDescription: requireRuntimeContribution(
      contribution.prompt?.executeToolDescription,
      "prompt.executeToolDescription"
    ),
    extensionAiTools: requireRuntimeContribution(
      contribution.tools?.extensionAiTools,
      "tools.extensionAiTools"
    ),
    filesystemSystemPrompt: requireRuntimeContribution(
      contribution.prompt?.filesystemSystemPrompt,
      "prompt.filesystemSystemPrompt"
    ),
    skillSources: requireRuntimeContribution(
      contribution.tools?.skillSources,
      "tools.skillSources"
    ),
    webTools: requireRuntimeContribution(contribution.tools?.webTools, "tools.webTools")
  }
  const context = {
    contextRetrieval: requireRuntimeContribution(
      contribution.context?.contextRetrieval,
      "context.contextRetrieval"
    ),
    guardrail: requireRuntimeContribution(contribution.context?.guardrail, "context.guardrail"),
    memory: contribution.context?.memory,
    titleGenerator: requireRuntimeContribution(
      contribution.prompt?.titleGenerator,
      "prompt.titleGenerator"
    ),
    workspaceFileContext: contribution.context?.workspaceFileContext
  }
  const control = {
    approvalController: requireRuntimeContribution(
      contribution.control?.approvalController,
      "control.approvalController"
    ),
    compaction: {
      summarization: requireRuntimeContribution(
        contribution.compaction?.summarization,
        "compaction.summarization"
      )
    },
    pauseController: requireRuntimeContribution(
      contribution.control?.pauseController,
      "control.pauseController"
    ),
    runLifecycleController: requireRuntimeContribution(
      contribution.control?.runLifecycleController,
      "control.runLifecycleController"
    )
  }
  const observation = {
    sink: createRuntimeObservationSink(contribution.observation)
  }

  return {
    checkpoint,
    context,
    control,
    environment,
    execution,
    observation
  }
}

function requireRuntimeContribution<T>(value: T | undefined, path: string): T {
  if (value === undefined) {
    throw new Error(`[Runtime] Missing runtime capability contribution: ${path}.`)
  }

  return value
}
