import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import { createRuntimeThreadContextRegistry } from "./runtime-thread-context"
import { createRuntimeThread } from "./runtime-thread-implementation"
import type { RuntimeThread, RuntimeThreadFactoryInput, RuntimeThreadInput } from "./runtime-thread"

interface RuntimeThreadFactory<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  thread: (
    input: RuntimeThreadInput
  ) => RuntimeThread<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
}

export function createRuntimeThreadFactory<
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
  >
): RuntimeThreadFactory<TContextInclusion, TInvokeRunLifecycleInput, TResumeRunLifecycleInput> {
  const contexts = createRuntimeThreadContextRegistry()

  return {
    thread(threadInput) {
      return createRuntimeThread(input, contexts.context(threadInput))
    }
  }
}
