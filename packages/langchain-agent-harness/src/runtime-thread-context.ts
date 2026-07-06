import { createRuntimeExecutionFactory } from "./runtime-execution-factory"
import type {
  CreateRuntimeThreadFactoryInput
} from "./runtime-contract"
import type { RuntimeThreadScope } from "./runtime-scope"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"

export interface RuntimeThreadRunState {
  currentRunId: string | null
}

export interface RuntimeThreadContext {
  createRunExecution: RuntimeExecutionFactory
  runState: RuntimeThreadRunState
  thread: RuntimeThreadScope
}

export function createRuntimeThreadContext<
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
  thread: RuntimeThreadScope
): RuntimeThreadContext {
  return {
    createRunExecution: createRuntimeExecutionFactory({
      host: input.host,
      thread
    }),
    runState: {
      currentRunId: null
    },
    thread
  }
}

export function createRuntimeThreadContextFromControls(input: {
  createRunExecution: RuntimeExecutionFactory
  thread: RuntimeThreadScope
}): RuntimeThreadContext {
  return {
    createRunExecution: input.createRunExecution,
    runState: {
      currentRunId: null
    },
    thread: input.thread
  }
}
