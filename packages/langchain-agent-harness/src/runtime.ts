import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type {
  RuntimeControlCapabilities,
  RuntimeExecutionCapabilities
} from "./runtime-capabilities"
import type { RuntimeHostContract } from "./runtime-contract"
import {
  createRuntimeExecutionFactory,
  type RuntimeExecutionFactory
} from "./runtime-execution-factory"
import { createRuntimeObservationSink } from "./runtime-observation"
import { createRuntimeThreadFactory } from "./runtime-thread-factory"
import type {
  RuntimeThread,
  RuntimeThreadFactoryInput,
  RuntimeThreadInput,
  RuntimeThreadInvokeExecutionBindingInput,
  RuntimeThreadResumeExecutionBindingInput
} from "./runtime-thread"

export interface Runtime<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  thread(
    input: RuntimeThreadInput
  ): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
}

export interface RuntimeInvokeExecutionResolutionInput<
  TInvokeRunLifecycleInput = unknown
> extends RuntimeThreadInvokeExecutionBindingInput<TInvokeRunLifecycleInput> {
  signal: AbortSignal
}

export interface RuntimeResumeExecutionResolutionInput<
  TResumeRunLifecycleInput = unknown
> extends RuntimeThreadResumeExecutionBindingInput<TResumeRunLifecycleInput> {
  signal: AbortSignal
}

export interface CreateRuntimeInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  bindExecution: {
    invoke(
      input: RuntimeInvokeExecutionResolutionInput<TInvokeRunLifecycleInput>
    ): RuntimeExecutionCapabilities<TContextInclusion, TGuardrailMetadata>
    resume(
      input: RuntimeResumeExecutionResolutionInput<TResumeRunLifecycleInput>
    ): RuntimeExecutionCapabilities<TContextInclusion, TGuardrailMetadata>
  }
  control: RuntimeControlCapabilities<
    TContextInclusion,
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
): Runtime<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  const bindExecution: RuntimeThreadFactoryInput<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >["bindExecution"] = {
    invoke: (binding) =>
      createBoundRuntimeExecution({
        binding: (signal) => input.bindExecution.invoke({ ...binding, signal }),
        control: input.control,
        thread: binding.thread
      }),
    resume: (binding) =>
      createBoundRuntimeExecution({
        binding: (signal) => input.bindExecution.resume({ ...binding, signal }),
        control: input.control,
        thread: binding.thread
      })
  }
  const threadFactory = createRuntimeThreadFactory({
    bindExecution,
    pauseController: input.control.pauseController,
    runLifecycleController: input.control.runLifecycleController
  })

  return {
    thread(threadInput) {
      return threadFactory.thread(threadInput)
    }
  }
}

function createBoundRuntimeExecution<
  TContextInclusion extends JingleContextInclusionStateItem,
  TGuardrailMetadata,
  TReview,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
>(input: {
  binding: (
    signal: AbortSignal
  ) => RuntimeExecutionCapabilities<TContextInclusion, TGuardrailMetadata>
  control: RuntimeControlCapabilities<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  thread: RuntimeThreadInput
}): RuntimeExecutionFactory {
  return async (operationInput) => {
    operationInput.signal.throwIfAborted()
    const capabilities = input.binding(operationInput.signal)
    operationInput.signal.throwIfAborted()
    const factory = createRuntimeExecutionFactory({
      host: createRuntimeHost(capabilities, input.control),
      thread: input.thread
    })
    return factory(operationInput)
  }
}

function createRuntimeHost<
  TContextInclusion extends JingleContextInclusionStateItem,
  TGuardrailMetadata,
  TReview,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
>(
  contribution: RuntimeExecutionCapabilities<TContextInclusion, TGuardrailMetadata>,
  controlInput: RuntimeControlCapabilities<
    TContextInclusion,
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
  return {
    checkpoint: {
      checkpointer: contribution.checkpoint.checkpointer
    },
    context: {
      contextRetrieval: contribution.context.contextRetrieval,
      guardrail: contribution.context.guardrail,
      memory: contribution.context.memory,
      titleGenerator: contribution.prompt.titleGenerator,
      workspaceFileContext: contribution.context.workspaceFileContext
    },
    control: {
      approvalController: contribution.control.approvalController,
      compaction: {
        summarization: contribution.compaction.summarization
      },
      pauseController: controlInput.pauseController,
      runLifecycleController: controlInput.runLifecycleController
    },
    environment: {
      artifactPresentation: contribution.tools.artifactPresentation,
      backend: contribution.tools.backend,
      desktopAutomationTools: contribution.tools.desktopAutomationTools,
      executeToolDescription: contribution.prompt.executeToolDescription,
      extensionAiTools: contribution.tools.extensionAiTools,
      filesystemSystemPrompt: contribution.prompt.filesystemSystemPrompt,
      skillSources: contribution.tools.skillSources,
      webTools: contribution.tools.webTools
    },
    execution: {
      model: contribution.model.model,
      systemPrompt: contribution.context.systemPrompt
    },
    observation: {
      sink: createRuntimeObservationSink(contribution.observation)
    }
  }
}
