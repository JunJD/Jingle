import { createJingleCompactionController } from "./compaction-controller"
import { createRuntimeGraphEngine } from "./harness-runtime"
import { buildRuntimeInvokeConfig, buildRuntimeResumeConfig } from "./run-config"
import { assembleRuntimeExecution } from "./runtime-execution-assembly"
import { createRuntimeObservationExecution } from "./runtime-observation-capability"
import type {
  RuntimeHostContract,
  RuntimeRunContextScope,
  RuntimeThreadScope
} from "./runtime-contract"
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
) => RuntimeRunExecution

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
  return (operationInput) => {
    const {
      checkpoint,
      control,
      execution: executionHost,
      observation
    } = input.host
    const runContext: RuntimeRunContextScope = {
      ...input.thread,
      runId: operationInput.runId
    }
    const observationExecution = createRuntimeObservationExecution({
      modelId: operationInput.modelId,
      observation,
      runContext
    })
    const runtimeExecution = assembleRuntimeExecution({
      host: input.host,
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
