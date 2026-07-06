import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"
import { getRunIdFromToolRuntime } from "./tool-runtime"
import {
  jingleAgentContextInclusionsStateSchema,
  type JingleContextInclusionStateItem
} from "./context-inclusion-state"
import { runtimeRecordingRefsValue } from "./runtime-state"
import { StateSchema } from "@langchain/langgraph"
import { projectJingleMemoryRecordingRefs } from "./memory-recording-projection"
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

export interface CreateJingleMemoryHookOptions<TContextInclusion = unknown>
  extends RuntimeMemoryConfig<TContextInclusion> {
  fallbackRunId: string
}

type JingleMemoryToolState<TContextInclusion = unknown> = {
  contextInclusions: TContextInclusion[]
}

type JingleMemoryHarnessState = {
  contextInclusions: JingleContextInclusionStateItem[]
}

function readMemoryContextInclusions<TContextInclusion>(
  runtime: ToolRuntime<JingleMemoryToolState<TContextInclusion>>
): TContextInclusion[] {
  if (!Array.isArray(runtime.state.contextInclusions)) {
    throw new Error("[JingleMemory] Tool runtime state is missing contextInclusions.")
  }

  return runtime.state.contextInclusions
}

function createJingleMemoryRuntimeMiddleware<TContextInclusion = unknown>(
  options: CreateJingleMemoryHookOptions<TContextInclusion>
) {
  const suggestPersonalMemoryTool = options.enableSuggestionTool
    ? tool(
        async (
          input: JingleSuggestPersonalMemoryInput,
          runtime: ToolRuntime<JingleMemoryToolState<TContextInclusion>>
        ) =>
          options.suggestPersonalMemory(input, {
            contextInclusions: readMemoryContextInclusions(runtime),
            runId: getRunIdFromToolRuntime(runtime) ?? options.fallbackRunId
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

export function createJingleMemoryHook<TContextInclusion = unknown>(
  options: CreateJingleMemoryHookOptions<TContextInclusion>
): RuntimeMiddlewareHook {
  return defineJingleHarnessHook({
    name: "memory",
    phase: "model_call",
    adapterStateKeys: [],
    runtimeStateKeys: ["contextInclusions"],
    reads: ["contextInclusions"],
    writes: [],
    failureSemantics: "tool",
    observableSignals: ["state"],
    writePolicy: "none",
    createMiddleware: () => createJingleMemoryRuntimeMiddleware(options)
  })
}

function createJingleMemoryRecordingRefsRuntimeMiddleware() {
  return createMiddleware({
    name: "jingleMemoryRecordingRefs",
    stateSchema: new StateSchema({
      ...jingleAgentContextInclusionsStateSchema.fields,
      recordingRefs: runtimeRecordingRefsValue
    }),
    afterAgent: (state: JingleMemoryHarnessState) => {
      const recordingRefs = projectJingleMemoryRecordingRefs({
        contextInclusions: state.contextInclusions
      })
      return recordingRefs.length > 0 ? { recordingRefs } : undefined
    }
  })
}

export function createJingleMemoryRecordingRefsHook(): RuntimeMiddlewareHook {
  return defineJingleHarnessHook({
    name: "memoryRecordingRefs",
    phase: "agent_loop",
    adapterStateKeys: [],
    runtimeStateKeys: ["contextInclusions"],
    reads: ["contextInclusions"],
    writes: ["recordingRefs"],
    failureSemantics: "projection",
    observableSignals: ["state", "stream", "recording"],
    writePolicy: "derived-projection",
    createMiddleware: createJingleMemoryRecordingRefsRuntimeMiddleware
  })
}
