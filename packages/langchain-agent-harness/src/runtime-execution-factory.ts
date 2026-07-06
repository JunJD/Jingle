import { createJingleCompactionController } from "./compaction-controller"
import { createRuntimeGraphEngine } from "./harness-runtime"
import { buildRuntimeInvokeConfig, buildRuntimeResumeConfig } from "./run-config"
import { assembleRuntimeExecution } from "./runtime-execution-assembly"
import { createRuntimeObservationExecution } from "./runtime-observation-capability"
import type {
  RuntimeHostContract,
  RuntimeResolvedHostContract
} from "./runtime-contract"
import type {
  RuntimeRunCapabilityScope,
  RuntimeRunContextScope,
  RuntimeThreadScope
} from "./runtime-scope"
import type {
  RuntimeRunExecution,
  RuntimeRunExecutionInput
} from "./runtime-execution"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"

export interface RuntimeExecutionFactoryInput<
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
  thread: RuntimeThreadScope
}

export type RuntimeExecutionFactory = (
  operationInput: RuntimeRunExecutionInput
) => Promise<RuntimeRunExecution>

export function createRuntimeExecutionFactory<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeExecutionFactoryInput<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeExecutionFactory {
  return async (operationInput) => {
    const runContext: RuntimeRunContextScope = {
      ...input.thread,
      runId: operationInput.runId
    }
    const capabilityScope: RuntimeRunCapabilityScope = {
      ...runContext,
      modelId: operationInput.modelId
    }
    const resolvedHost = await resolveRuntimeHostForRun({
      capabilityScope,
      host: input.host,
      thread: input.thread
    })
    const {
      checkpoint,
      control,
      execution: executionHost,
      observation
    } = resolvedHost
    const observationExecution = createRuntimeObservationExecution({
      modelId: operationInput.modelId,
      observation,
      runContext
    })
    const runtimeExecution = assembleRuntimeExecution({
      host: resolvedHost,
      runContext,
      steeringBuffer: operationInput.steeringBuffer,
      thread: input.thread
    })
    const compactionSummarization = control.compaction.summarization
    const agent = createRuntimeGraphEngine({
      approvalController: control.approvalController,
      callbacks: [
        ...observationExecution.callbacks,
        ...(operationInput.callbacks ?? [])
      ],
      checkpointer: checkpoint.checkpointer,
      compaction: {
        summarization: compactionSummarization
      },
      middleware: runtimeExecution.middleware,
      model: executionHost.model,
      systemPrompt: executionHost.systemPrompt,
      traceConfig: observationExecution.runtimeTraceConfig
    })
    const compactionController = createJingleCompactionController({
      runtime: agent,
      summarization: compactionSummarization
    })

    return {
      compact: (compactInput) =>
        compactionController.compact({
          ...compactInput,
          runId: operationInput.runId,
          threadId: input.thread.threadId,
          workspacePath: input.thread.workspacePath
        }),
      streamInvoke: (streamInput, streamOptions) =>
        agent.stream(
          streamInput,
          buildRuntimeInvokeConfig({
            runId: operationInput.runId,
            signal: streamOptions.signal,
            threadId: input.thread.threadId,
            traceConfig: observationExecution.createRunTraceConfig({
              source: "invoke"
            }),
            workspacePath: input.thread.workspacePath
          })
        ),
      streamResume: (streamInput, streamOptions) =>
        agent.stream(
          streamInput,
          buildRuntimeResumeConfig({
            runId: operationInput.runId,
            signal: streamOptions.signal,
            threadId: input.thread.threadId,
            traceConfig: observationExecution.createRunTraceConfig({
              source: "resume"
            }),
            workspacePath: input.thread.workspacePath
          })
        )
    }
  }
}

async function resolveRuntimeHostForRun<
  TContextInclusion extends JingleContextInclusionStateItem,
  TGuardrailMetadata,
  TReview,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
>(input: {
  capabilityScope: RuntimeRunCapabilityScope
  host: RuntimeHostContract<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  thread: RuntimeThreadScope
}): Promise<
  RuntimeResolvedHostContract<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
> {
  const { capabilityScope, host, thread } = input

  return {
    checkpoint: {
      checkpointer: await host.checkpoint.checkpointer(thread)
    },
    context: host.context,
    control: {
      approvalController: await host.control.approvalController(capabilityScope),
      compaction: {
        summarization: await host.control.compaction.summarization(capabilityScope)
      },
      pauseController: host.control.pauseController,
      runLifecycleController: host.control.runLifecycleController
    },
    environment: {
      artifactPresentation: host.environment.artifactPresentation,
      backend: await host.environment.backend(thread),
      desktopAutomationTools: host.environment.desktopAutomationTools,
      executeToolDescription: host.environment.executeToolDescription(thread),
      extensionAiTools: host.environment.extensionAiTools,
      filesystemSystemPrompt: host.environment.filesystemSystemPrompt(thread),
      skillSources: host.environment.skillSources(thread),
      webTools: host.environment.webTools
    },
    execution: {
      model: await host.execution.model(capabilityScope),
      systemPrompt: host.execution.systemPrompt(thread)
    },
    observation: host.observation
  }
}
