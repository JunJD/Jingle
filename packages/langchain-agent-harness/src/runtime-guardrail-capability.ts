import { createGuardrailMiddleware } from "./guardrail-middleware"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import type { RuntimeContextHostContract } from "./runtime-contract"
import type { RuntimeThreadScope } from "./runtime-scope"

export interface CreateRuntimeGuardrailEntriesInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  context: RuntimeContextHostContract<TContextInclusion, TGuardrailMetadata>
  thread: RuntimeThreadScope
}

export function createRuntimeGuardrailEntries<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
>(
  input: CreateRuntimeGuardrailEntriesInput<TContextInclusion, TGuardrailMetadata>
): readonly RuntimeExecutionMiddleware[] {
  const config = input.context.guardrail(input.thread)

  return [
    createGuardrailMiddleware<TGuardrailMetadata>({
      ...config,
      threadId: input.thread.threadId,
      workspacePath: input.thread.workspacePath
    })
  ]
}
