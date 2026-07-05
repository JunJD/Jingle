import type {
  CreateRuntimeThreadFactoryInput,
  RuntimePauseControllerContract,
  RuntimeRunLifecycleControllerContract,
  RuntimeThreadScope
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeThread } from "./runtime-thread"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import { createRuntimeThreadRunLifecycleControl } from "./runtime-thread-lifecycle"
import { createRuntimeThreadRunLifecycleControlFromController } from "./runtime-thread-lifecycle"
import { createRuntimeThreadOperationControl } from "./runtime-thread-operations"
import {
  createRuntimeThreadContext,
  createRuntimeThreadContextFromControls
} from "./runtime-thread-context"
import { createRuntimeThreadStreamDrainControl } from "./runtime-thread-stream"
import { createRuntimeThreadStreamDrainControlFromController } from "./runtime-thread-stream"

export interface RuntimeThreadControlsInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  createRunExecution: RuntimeExecutionFactory
  runLifecycleController: RuntimeRunLifecycleControllerContract<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  pauseController: RuntimePauseControllerContract<TReview>
  thread: RuntimeThreadScope
}

export function createRuntimeThread<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: CreateRuntimeThreadFactoryInput<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >,
  threadInput: RuntimeThreadScope
): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  const context = createRuntimeThreadContext(input, threadInput)

  return {
    ...createRuntimeThreadRunLifecycleControl(input, context),
    ...createRuntimeThreadOperationControl<TContextInclusion>(context),
    ...createRuntimeThreadStreamDrainControl(input, context.thread)
  }
}

export function createRuntimeThreadFromControls<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeThreadControlsInput<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  const context = createRuntimeThreadContextFromControls({
    createRunExecution: input.createRunExecution,
    thread: input.thread
  })

  return {
    ...createRuntimeThreadRunLifecycleControlFromController({
      runLifecycleController: input.runLifecycleController,
      context
    }),
    ...createRuntimeThreadOperationControl<TContextInclusion>(context),
    ...createRuntimeThreadStreamDrainControlFromController({
      pauseController: input.pauseController,
      thread: context.thread
    })
  }
}
