import { createJingleContextRetrievalToolsHook } from "./context-retrieval-tools-middleware"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import { createJingleMemoryHook, createJingleMemoryRecordingRefsHook } from "./memory-middleware"
import type { RuntimeContextHostContract, RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-contract"
import { createJingleWorkspaceFileContextMiddleware } from "./workspace-file-context-middleware"

export interface CreateRuntimeContextEntriesInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  context: RuntimeContextHostContract<TContextInclusion, TGuardrailMetadata>
  runContext: RuntimeRunContextScope
  thread: RuntimeThreadScope
}

export function createRuntimeContextEntries<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
>(
  input: CreateRuntimeContextEntriesInput<TContextInclusion, TGuardrailMetadata>
): readonly RuntimeExecutionMiddleware[] {
  const { context, runContext, thread } = input
  const memoryOptions = context.memory?.(runContext)
  const workspaceFileContextOptions = context.workspaceFileContext?.(thread)

  return compactRuntimeEntries([
    createJingleContextRetrievalToolsHook<TContextInclusion>({
      runId: runContext.runId,
      ...context.contextRetrieval(runContext)
    }),
    memoryOptions
      ? createJingleMemoryHook({
          ...memoryOptions,
          fallbackRunId: runContext.runId
        })
      : undefined,
    memoryOptions ? createJingleMemoryRecordingRefsHook() : undefined,
    workspaceFileContextOptions
      ? createJingleWorkspaceFileContextMiddleware(workspaceFileContextOptions)
      : undefined
  ])
}

function compactRuntimeEntries<TEntry>(
  entries: readonly (TEntry | null | undefined)[]
): TEntry[] {
  return entries.filter((candidate): candidate is TEntry => candidate != null)
}
