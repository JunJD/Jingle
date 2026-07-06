import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type {
  CreateRuntimeThreadFactoryInput
} from "./runtime-contract"
import type { RuntimeThreadScope } from "./runtime-scope"
import type { RuntimeThread } from "./runtime-thread"
import { createRuntimeThread } from "./runtime-thread-implementation"

interface RuntimeThreadFactory<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  thread: (
    input: RuntimeThreadScope
  ) => RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
}

export function createRuntimeThreadFactory<
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
  >
): RuntimeThreadFactory<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  return {
    thread(threadInput) {
      return createRuntimeThread(input, threadInput)
    }
  }
}
