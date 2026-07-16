import {
  createJingleSummarizationController,
  JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT
} from "./harness-runtime/summarization"
import type { JingleSummarizationMiddlewareOptions } from "./harness-runtime/summarization"
import type { JingleSummarizationControllerOptions } from "./harness-runtime/summarization"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"

export { JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT } from "./harness-runtime/summarization"

export interface CreateRuntimeAgentLoopEntriesInput {
  rootTailEntries: readonly RuntimeExecutionMiddleware[]
  toolEntries: readonly RuntimeExecutionMiddleware[]
}

export function buildJingleSummarizationMiddlewareOptions(
  input: Pick<JingleSummarizationMiddlewareOptions, "backend" | "model">
): JingleSummarizationMiddlewareOptions {
  return {
    backend: input.backend,
    model: input.model,
    summaryPrompt: JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT
  }
}

export function createRuntimeCompactionSummarizationController(
  input: Pick<JingleSummarizationControllerOptions, "model">
) {
  return createJingleSummarizationController({
    historyPersistence: "none",
    model: input.model,
    summaryPrompt: JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT
  })
}

export function createRuntimeAgentLoopEntries(
  input: CreateRuntimeAgentLoopEntriesInput
): readonly RuntimeExecutionMiddleware[] {
  return [...input.toolEntries, ...input.rootTailEntries]
}
