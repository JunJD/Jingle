import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import { getRunIdFromToolRuntime } from "./tool-runtime"
import { jingleAgentContextInclusionsStateSchema } from "./context-inclusion-state"
import type {
  RuntimeMemoryConfig,
  RuntimeSuggestPersonalMemoryContext,
  RuntimeSuggestPersonalMemoryInput
} from "./runtime-context"

export const JINGLE_SUGGEST_PERSONAL_MEMORY_TOOL_NAME = "suggest_personal_memory"

export const jingleSuggestPersonalMemoryInputSchema = z
  .object({
    content: z.string().trim().min(1),
    reason: z.string().trim().optional(),
    scope: z.enum(["global", "workspace"]),
    type: z.enum(["about_me", "workspace_context", "correction"])
  })
  .strict()

export type JingleSuggestPersonalMemoryInput = RuntimeSuggestPersonalMemoryInput

export type JingleSuggestPersonalMemoryContext<TContextInclusion = unknown> =
  RuntimeSuggestPersonalMemoryContext<TContextInclusion>

export type CreateMemoryMiddlewareOptions<TContextInclusion = unknown> =
  RuntimeMemoryConfig<TContextInclusion>

type JingleMemoryToolState<TContextInclusion = unknown> = {
  contextInclusions: TContextInclusion[]
}

function readMemoryContextInclusions<TContextInclusion>(
  runtime: ToolRuntime<JingleMemoryToolState<TContextInclusion>>
): TContextInclusion[] {
  if (!Array.isArray(runtime.state.contextInclusions)) {
    throw new Error("[JingleMemory] Tool runtime state is missing contextInclusions.")
  }

  return runtime.state.contextInclusions
}

function readMemoryRunId(runtime: ToolRuntime<unknown>): string {
  const runId = getRunIdFromToolRuntime(runtime)
  if (!runId) {
    throw new Error("[JingleMemory] Tool runtime config is missing run_id.")
  }

  return runId
}

function createJingleMemoryRuntimeMiddleware<TContextInclusion = unknown>(
  options: CreateMemoryMiddlewareOptions<TContextInclusion>
) {
  const suggestPersonalMemoryTool = options.enableSuggestionTool
    ? tool(
        async (
          input: JingleSuggestPersonalMemoryInput,
          runtime: ToolRuntime<JingleMemoryToolState<TContextInclusion>>
        ) =>
          options.suggestPersonalMemory(input, {
            contextInclusions: readMemoryContextInclusions(runtime),
            runId: readMemoryRunId(runtime)
          }),
        {
          description:
            "Suggest a durable personal memory only when the user explicitly asks to remember something, corrects a reusable behavior, or confirms stable current-workspace context. This creates a pending suggestion, not an active memory.",
          name: JINGLE_SUGGEST_PERSONAL_MEMORY_TOOL_NAME,
          schema: jingleSuggestPersonalMemoryInputSchema
        }
      )
    : null

  return createMiddleware({
    name: "jingleMemory",
    stateSchema: jingleAgentContextInclusionsStateSchema,
    ...(suggestPersonalMemoryTool ? { tools: [suggestPersonalMemoryTool] } : {}),
    wrapModelCall: async (request, handler) => {
      if (!options.applyMemoryContextToSystemPrompt) {
        return handler(request)
      }

      return handler({
        ...request,
        systemPrompt: await options.applyMemoryContextToSystemPrompt(request.systemPrompt)
      })
    }
  })
}

export function createMemoryMiddleware<TContextInclusion = unknown>(
  options: CreateMemoryMiddlewareOptions<TContextInclusion>
) {
  return createJingleMemoryRuntimeMiddleware(options)
}
