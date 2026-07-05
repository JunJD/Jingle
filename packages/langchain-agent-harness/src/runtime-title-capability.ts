import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import type { RuntimeContextHostContract } from "./runtime-contract"
import { createJingleTitleHook } from "./title-middleware"

export interface CreateRuntimeTitleEntriesInput {
  context: Pick<RuntimeContextHostContract, "titleGenerator">
}

export function createRuntimeTitleEntries(
  input: CreateRuntimeTitleEntriesInput
): readonly RuntimeExecutionMiddleware[] {
  return [
    createJingleTitleHook({
      generateTitle: input.context.titleGenerator
    })
  ]
}
