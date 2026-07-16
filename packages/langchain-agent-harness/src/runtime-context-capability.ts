import { createContextRetrievalToolsMiddleware } from "./context-retrieval-tools-middleware"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import { createMemoryMiddleware } from "./memory-middleware"
import type { RuntimeContextHostContract } from "./runtime-contract"
import type { RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-scope"
import { createJingleWorkspaceFileContextMiddleware } from "./workspace-file-context-middleware"

export interface CreateRuntimeContextEntriesInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
> {
  context: RuntimeContextHostContract<TContextInclusion, TGuardrailMetadata>
  runContext: RuntimeRunContextScope
  thread: RuntimeThreadScope
}

export interface RuntimeContextEntries {
  memoryRecordingProjectionEnabled: boolean
  middleware: readonly RuntimeExecutionMiddleware[]
}

export function createRuntimeContextEntries<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>
>(
  input: CreateRuntimeContextEntriesInput<TContextInclusion, TGuardrailMetadata>
): RuntimeContextEntries {
  const { context, runContext, thread } = input
  const memoryOptions = context.memory?.(runContext)
  const workspaceFileContextOptions = context.workspaceFileContext?.(thread)

  return {
    memoryRecordingProjectionEnabled: memoryOptions !== undefined,
    middleware: compactRuntimeEntries([
      createContextRetrievalToolsMiddleware<TContextInclusion>({
        runId: runContext.runId,
        ...context.contextRetrieval(runContext)
      }),
      memoryOptions
        ? createMemoryMiddleware({
            ...memoryOptions
          })
        : undefined,
      workspaceFileContextOptions
        ? createJingleWorkspaceFileContextMiddleware(workspaceFileContextOptions)
        : undefined
    ])
  }
}

function compactRuntimeEntries<TEntry>(entries: readonly (TEntry | null | undefined)[]): TEntry[] {
  return entries.filter((candidate): candidate is TEntry => candidate != null)
}
