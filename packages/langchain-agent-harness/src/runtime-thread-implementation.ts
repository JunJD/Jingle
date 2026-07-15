import type {
  RuntimePauseControllerContract,
  RuntimeRunLifecycleControllerContract
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeThreadScope } from "./runtime-scope"
import type {
  RuntimeThread,
  RuntimeThreadFactoryInput,
  RuntimeThreadOperationControl,
  RuntimeThreadRunLifecycleControl,
  RuntimeThreadStreamControl
} from "./runtime-thread"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import { createRuntimeThreadRunLifecycleControl } from "./runtime-thread-lifecycle"
import { createRuntimeThreadRunLifecycleControlFromController } from "./runtime-thread-lifecycle"
import { createRuntimeThreadOperationControl } from "./runtime-thread-operations"
import { createRuntimeThreadContext, type RuntimeThreadContext } from "./runtime-thread-context"
import { createRuntimeThreadStreamDrainControlFromController } from "./runtime-thread-stream"
import { createRuntimeThreadInvokeRun, createRuntimeThreadResumeRun } from "./runtime-thread-run"

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
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeThreadFactoryInput<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >,
  context: RuntimeThreadContext
): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  return createRuntimeThreadControl({
    lifecycle: createRuntimeThreadRunLifecycleControl(input, context),
    operations: createRuntimeThreadOperationControl<TContextInclusion>(context),
    stream: createRuntimeThreadStreamDrainControlFromController({
      pauseController: input.pauseController,
      thread: context.thread
    })
  })
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
  const context = createRuntimeThreadContext(input.thread)
  const bindExecution = {
    invoke: () => input.createRunExecution,
    resume: () => input.createRunExecution
  }

  return createRuntimeThreadControl({
    lifecycle: createRuntimeThreadRunLifecycleControlFromController({
      bindExecution,
      runLifecycleController: input.runLifecycleController,
      context
    }),
    operations: createRuntimeThreadOperationControl<TContextInclusion>(context),
    stream: createRuntimeThreadStreamDrainControlFromController({
      pauseController: input.pauseController,
      thread: context.thread
    })
  })
}

function createRuntimeThreadControl<
  TContextInclusion extends JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
>(input: {
  lifecycle: RuntimeThreadRunLifecycleControl<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  operations: RuntimeThreadOperationControl<TContextInclusion>
  stream: RuntimeThreadStreamControl
}): RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  const controls = {
    lifecycle: input.lifecycle,
    operations: input.operations,
    stream: input.stream
  }

  return {
    compact: input.operations.compact,
    startInvoke: async (invoke) =>
      createRuntimeThreadInvokeRun({
        controls,
        start: await input.lifecycle.beginInvokeRun({ invoke })
      }),
    startResume: async (resume) =>
      createRuntimeThreadResumeRun({
        controls,
        decision: resume.decision,
        start: await input.lifecycle.beginResumeRun({ resume })
      })
  }
}
