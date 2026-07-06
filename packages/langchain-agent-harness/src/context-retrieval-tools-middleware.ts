import { ToolMessage } from "@langchain/core/messages"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import {
  jingleAgentContextInclusionsStateSchema,
  upsertJingleContextInclusions,
  type JingleContextInclusionStateItem
} from "./context-inclusion-state"
import type {
  RuntimeContextRetrievalConfig,
  RuntimeContextRetrievalResult,
  RuntimeContextRetrievalToolContext,
  RuntimeGetMessageContextInput,
  RuntimeGetTraceEvidenceInput,
  RuntimeSearchHistoryInput
} from "./runtime-context"
import {
  buildJingleToolResultUpdateCommand,
  getRunIdFromToolRuntime,
  getToolCallIdFromToolRuntime,
  isJingleGraphInterrupt
} from "./tool-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"

export const JINGLE_SEARCH_HISTORY_TOOL_NAME = "search_history"
export const JINGLE_GET_MESSAGE_CONTEXT_TOOL_NAME = "get_message_context"
export const JINGLE_GET_TRACE_EVIDENCE_TOOL_NAME = "get_trace_evidence"

const CONTEXT_RETRIEVAL_TOOL_NAMES = new Set([
  JINGLE_SEARCH_HISTORY_TOOL_NAME,
  JINGLE_GET_MESSAGE_CONTEXT_TOOL_NAME,
  JINGLE_GET_TRACE_EVIDENCE_TOOL_NAME
])

export const jingleGetMessageContextInputSchema = z
  .object({
    after: z.number().int().min(0).max(8).optional(),
    before: z.number().int().min(0).max(8).optional(),
    messageId: z.string().trim().min(1),
    threadId: z.string().trim().min(1)
  })
  .strict()

export const jingleSearchHistoryInputSchema = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
    query: z.string().trim().min(1),
    threadId: z.string().trim().min(1).optional()
  })
  .strict()

export const jingleGetTraceEvidenceInputSchema = z
  .object({
    artifactId: z.string().trim().min(1).optional(),
    includeInput: z.boolean().optional(),
    includeOutput: z.boolean().optional(),
    runId: z.string().trim().min(1).optional(),
    toolCallId: z.string().trim().min(1).optional(),
    traceId: z.string().trim().min(1).optional(),
    traceStepId: z.string().trim().min(1).optional()
  })
  .strict()
  .refine(
    (input) =>
      Boolean(
        input.artifactId || input.runId || input.toolCallId || input.traceId || input.traceStepId
      ),
    "Provide runId, traceId, traceStepId, toolCallId, or artifactId."
  )

export type JingleGetMessageContextInput = RuntimeGetMessageContextInput
export type JingleSearchHistoryInput = RuntimeSearchHistoryInput
export type JingleGetTraceEvidenceInput = RuntimeGetTraceEvidenceInput
export type JingleContextRetrievalToolContext<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeContextRetrievalToolContext<TInclusion>
export type JingleContextRetrievalToolResult<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = RuntimeContextRetrievalResult<TInclusion>

export interface CreateJingleContextRetrievalToolsMiddlewareOptions<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> extends RuntimeContextRetrievalConfig<TInclusion> {
  runId: string
}

type JingleContextRetrievalToolState<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = {
  contextInclusions: TInclusion[]
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createContextRetrievalToolErrorMessage(input: {
  error: unknown
  toolCallId: string
  toolName: string
}): ToolMessage {
  return new ToolMessage({
    content: `Context retrieval tool '${input.toolName}' failed: ${messageFromError(input.error)}. Retry with valid arguments or a different query.`,
    name: input.toolName,
    status: "error",
    tool_call_id: input.toolCallId
  })
}

function buildContextRetrievalToolContext<TInclusion extends JingleContextInclusionStateItem>(
  runtime: ToolRuntime<JingleContextRetrievalToolState<TInclusion>>,
  options: { runId: string }
): JingleContextRetrievalToolContext<TInclusion> {
  const toolCallId = getToolCallIdFromToolRuntime(runtime)
  if (!toolCallId) {
    throw new Error("Context retrieval tool message requires a tool call id.")
  }

  if (!Array.isArray(runtime.state.contextInclusions)) {
    throw new Error("[JingleContextRetrieval] Tool runtime state is missing contextInclusions.")
  }

  return {
    existingContextInclusions: runtime.state.contextInclusions,
    runId: getRunIdFromToolRuntime(runtime) ?? options.runId,
    toolCallId
  }
}

function buildContextRetrievalToolOutput<
  TInclusion extends JingleContextInclusionStateItem
>(input: {
  result: JingleContextRetrievalToolResult<TInclusion>
  toolContext: JingleContextRetrievalToolContext<TInclusion>
  toolName: string
}) {
  if (!input.result.contextInclusions?.length) {
    return input.result.content
  }

  const contextInclusions = upsertJingleContextInclusions(
    input.toolContext.existingContextInclusions,
    input.result.contextInclusions
  )

  return buildJingleToolResultUpdateCommand({
    toolResult: {
      content: input.result.content,
      name: input.toolName,
      toolCallId: input.toolContext.toolCallId
    },
    update: {
      contextInclusions
    }
  })
}

function createJingleContextRetrievalToolsRuntimeMiddleware<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
>(options: CreateJingleContextRetrievalToolsMiddlewareOptions<TInclusion>) {
  const getMessageContextTool = tool(
    async (
      input: JingleGetMessageContextInput,
      runtime: ToolRuntime<JingleContextRetrievalToolState<TInclusion>>
    ) => {
      const toolContext = buildContextRetrievalToolContext(runtime, options)
      const result = await options.getMessageContext(input, toolContext)
      return buildContextRetrievalToolOutput({
        result,
        toolContext,
        toolName: JINGLE_GET_MESSAGE_CONTEXT_TOOL_NAME
      })
    },
    {
      description:
        "Retrieve a bounded transcript window around a specific projected history message from a target thread. This records the focus message as retrieved history_message evidence when it exists.",
      name: JINGLE_GET_MESSAGE_CONTEXT_TOOL_NAME,
      schema: jingleGetMessageContextInputSchema
    }
  )

  const searchHistoryTool = tool(
    async (
      input: JingleSearchHistoryInput,
      runtime: ToolRuntime<JingleContextRetrievalToolState<TInclusion>>
    ) => {
      const toolContext = buildContextRetrievalToolContext(runtime, options)
      const result = await options.searchHistory(input, toolContext)
      return buildContextRetrievalToolOutput({
        result,
        toolContext,
        toolName: JINGLE_SEARCH_HISTORY_TOOL_NAME
      })
    },
    {
      description:
        "Search prior thread summaries first, then retrieve concrete projected chat messages from the local message FTS index and add matching evidence to runtime context state.",
      name: JINGLE_SEARCH_HISTORY_TOOL_NAME,
      schema: jingleSearchHistoryInputSchema
    }
  )

  const getTraceEvidenceTool = tool(
    async (
      input: JingleGetTraceEvidenceInput,
      runtime: ToolRuntime<JingleContextRetrievalToolState<TInclusion>>
    ) => {
      const toolContext = buildContextRetrievalToolContext(runtime, options)
      const result = await options.getTraceEvidence(input, toolContext)
      return buildContextRetrievalToolOutput({
        result,
        toolContext,
        toolName: JINGLE_GET_TRACE_EVIDENCE_TOOL_NAME
      })
    },
    {
      description:
        "Retrieve bounded execution evidence from projected agent traces by run, trace step, tool call, or artifact. This writes trace_step evidence and linked artifact evidence to runtime context state only when the sources exist.",
      name: JINGLE_GET_TRACE_EVIDENCE_TOOL_NAME,
      schema: jingleGetTraceEvidenceInputSchema
    }
  )

  return createMiddleware({
    name: "jingleContextRetrieval",
    stateSchema: jingleAgentContextInclusionsStateSchema,
    tools: [searchHistoryTool, getMessageContextTool, getTraceEvidenceTool],
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name
      if (!CONTEXT_RETRIEVAL_TOOL_NAMES.has(toolName)) {
        return handler(request)
      }

      try {
        return await handler(request)
      } catch (error) {
        if (isJingleGraphInterrupt(error)) {
          throw error
        }

        return createContextRetrievalToolErrorMessage({
          error,
          toolCallId: request.toolCall.id ?? "",
          toolName
        })
      }
    }
  })
}

export function createJingleContextRetrievalToolsHook<
  TInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
>(
  options: CreateJingleContextRetrievalToolsMiddlewareOptions<TInclusion>
): RuntimeMiddlewareHook {
  return defineJingleHarnessHook({
    name: "contextInclusions",
    phase: "agent_loop",
    adapterStateKeys: [],
    reads: ["contextInclusions"],
    runtimeStateKeys: ["contextInclusions"],
    writes: ["contextInclusions"],
    writePolicy: "command-update",
    failureSemantics: "tool",
    observableSignals: ["state", "stream"],
    createMiddleware: () => createJingleContextRetrievalToolsRuntimeMiddleware(options)
  })
}
