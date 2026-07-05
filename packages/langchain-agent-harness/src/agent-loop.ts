import { createJingleSummarizationController } from "./harness-runtime/summarization"
import type { JingleSummarizationMiddlewareOptions } from "./harness-runtime/summarization"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"

export interface CreateRuntimeAgentLoopEntriesInput {
  rootTailEntries: readonly RuntimeExecutionMiddleware[]
  toolEntries: readonly RuntimeExecutionMiddleware[]
}

export const JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for the next LLM that will resume this agent run.

Include:
- Current objective, current progress, and key decisions made
- Important constraints, user preferences, and repository conventions that must continue to be followed
- Files, symbols, URLs, commands, test results, errors, and data points needed to continue without re-reading everything
- Tools & patterns: which tools were used effectively, relevant flags/invocations, and tool-specific discoveries
- Tool calls made and their key results, especially pending approvals, artifacts, checkpoints, or external state that affects the next step
- What remains to be done, with clear next actions and known risks
- Direct user messages that must not drift, quoted when they define goals, constraints, or corrections

If earlier context was already summarized, merge it with the new evidence instead of summarizing the summary mechanically. Preserve uncertainty explicitly when evidence is incomplete.

Be concise, structured, and focused on task continuity. Do not invent facts. Respond only with the handoff summary.

Conversation to compact:
{conversation}`

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
  input: Pick<JingleSummarizationMiddlewareOptions, "backend" | "model">
) {
  return createJingleSummarizationController(buildJingleSummarizationMiddlewareOptions(input))
}

export function createRuntimeAgentLoopEntries(
  input: CreateRuntimeAgentLoopEntriesInput
): readonly RuntimeExecutionMiddleware[] {
  return [...input.toolEntries, ...input.rootTailEntries]
}
