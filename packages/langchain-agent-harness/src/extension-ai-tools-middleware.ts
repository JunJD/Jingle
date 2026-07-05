import { createMiddleware, tool, type AgentMiddleware, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import {
  buildJingleToolResultUpdateCommand,
  getRunIdFromToolRuntime,
  getToolCallIdFromToolRuntime,
  mapJingleAiMessageToolCalls
} from "./tool-runtime"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"
import type { JingleAgentStateArtifactsUpdate } from "./artifact-state"
import { projectJingleArtifactRecordingRefs } from "./artifact-recording-projection"
import type { RuntimeRecordingRef } from "./runtime-state"
import type {
  RuntimeCallExtensionToolContext,
  RuntimeCallExtensionToolInput,
  RuntimeExtensionToolCallUi,
  RuntimeExtensionToolContentResult,
  RuntimeExtensionToolContext,
  RuntimeExtensionToolResult,
  RuntimeExtensionToolsConfig,
  RuntimeExtensionToolStateUpdateResult,
  RuntimeLoadExtensionToolInput
} from "./runtime-contract"

export const JINGLE_LOAD_EXTENSION_TOOL_NAME = "loadExtension"
export const JINGLE_CALL_EXTENSION_TOOL_NAME = "callExtension"

export const jingleLoadExtensionInputSchema = z.object({
  extensionName: z.string().trim().min(1)
})

export const jingleCallExtensionInputSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  extensionName: z.string().trim().min(1),
  toolName: z.string().trim().min(1)
})

export type JingleLoadExtensionToolInput = RuntimeLoadExtensionToolInput
export type JingleCallExtensionToolInput = RuntimeCallExtensionToolInput
export type JingleExtensionToolContext = RuntimeExtensionToolContext
export type JingleCallExtensionToolContext = RuntimeCallExtensionToolContext
export type JingleExtensionToolContentResult = RuntimeExtensionToolContentResult

export interface JingleExtensionAiToolsStateUpdate {
  artifacts: JingleAgentStateArtifactsUpdate
}

export interface JingleExtensionAiToolsCommandUpdate extends JingleExtensionAiToolsStateUpdate {
  recordingRefs: RuntimeRecordingRef[]
}

export type JingleExtensionToolStateUpdateResult = RuntimeExtensionToolStateUpdateResult
export type JingleExtensionToolResult = RuntimeExtensionToolResult
export type JingleExtensionToolCallUi = RuntimeExtensionToolCallUi

export type CreateJingleExtensionAiToolsHookOptions = RuntimeExtensionToolsConfig

function hasJingleExtensionStateUpdate(
  result: JingleExtensionToolResult
): result is JingleExtensionToolStateUpdateResult {
  return "stateUpdate" in result
}

function createJingleLoadExtensionTool(options: CreateJingleExtensionAiToolsHookOptions) {
  return tool(
    async (input: JingleLoadExtensionToolInput, runtime: ToolRuntime) => {
      const result = await options.loadExtension(input, {
        runId: getRunIdFromToolRuntime(runtime)
      })
      return result.content
    },
    {
      description: `Load one extension by extensionName. Returns that extension's full callable tool details, input schemas, display metadata, auth status, and permission state, and makes those tools available to ${JINGLE_CALL_EXTENSION_TOOL_NAME} in the current run.`,
      name: JINGLE_LOAD_EXTENSION_TOOL_NAME,
      schema: jingleLoadExtensionInputSchema
    }
  )
}

function createJingleCallExtensionTool(options: CreateJingleExtensionAiToolsHookOptions) {
  return tool(
    async (input: JingleCallExtensionToolInput, runtime: ToolRuntime) => {
      const toolCallId = getToolCallIdFromToolRuntime(runtime)
      const result = await options.callExtension(input, {
        runId: getRunIdFromToolRuntime(runtime),
        toolCallId
      })

      if (!hasJingleExtensionStateUpdate(result)) {
        return result.content
      }

      if (!toolCallId) {
        throw new Error("Extension tool state updates require a tool call id.")
      }

      return buildJingleToolResultUpdateCommand<JingleExtensionAiToolsCommandUpdate>({
        toolResult: {
          content: result.content,
          name: JINGLE_CALL_EXTENSION_TOOL_NAME,
          toolCallId
        },
        update: {
          ...result.stateUpdate,
          recordingRefs: projectJingleArtifactRecordingRefs({
            update: result.stateUpdate.artifacts
          })
        }
      })
    },
    {
      description:
        "Execute a tool from a loaded extension. Call loadExtension first to load the extension's full tool details and input schemas, then pass extensionName, toolName, and args.",
      name: JINGLE_CALL_EXTENSION_TOOL_NAME,
      schema: jingleCallExtensionInputSchema
    }
  )
}

export type JingleExtensionAiToolsRuntimeMiddleware = AgentMiddleware<
  undefined,
  undefined,
  unknown,
  readonly [
    ReturnType<typeof createJingleLoadExtensionTool>,
    ReturnType<typeof createJingleCallExtensionTool>
  ]
>

function createJingleExtensionAiToolsRuntimeMiddleware(
  options: CreateJingleExtensionAiToolsHookOptions
): JingleExtensionAiToolsRuntimeMiddleware {
  const loadExtensionTool = createJingleLoadExtensionTool(options)
  const callExtensionTool = createJingleCallExtensionTool(options)

  return createMiddleware({
    name: "jingleExtensionAiCapabilities",
    tools: [loadExtensionTool, callExtensionTool],
    wrapModelCall: async (request, handler) => {
      const promptSections = options
        .buildPromptSections()
        .filter((section) => section.trim().length > 0)
      const nextRequest =
        promptSections.length > 0
          ? {
              ...request,
              systemPrompt: `${request.systemPrompt}\n\n${promptSections.join("\n\n")}`
            }
          : request
      const response = await handler(nextRequest)

      return mapJingleAiMessageToolCalls(response, (toolCall) => {
        if (toolCall.name !== JINGLE_CALL_EXTENSION_TOOL_NAME) {
          return toolCall
        }

        const parsedArgs = jingleCallExtensionInputSchema.safeParse(toolCall.args)
        const ui = parsedArgs.success
          ? (options.resolveCallExtensionToolUi?.(parsedArgs.data) ?? null)
          : null
        if (!ui) {
          return toolCall
        }

        return {
          ...toolCall,
          display: ui.display,
          presentation: ui.presentation
        }
      })
    }
  })
}

export function createJingleExtensionAiToolsHook(
  options: CreateJingleExtensionAiToolsHookOptions
): RuntimeMiddlewareHook<JingleExtensionAiToolsRuntimeMiddleware> {
  return defineJingleHarnessHook({
    name: "extensionAiTools",
    phase: "agent_loop",
    adapterStateKeys: ["extensionAiSession"],
    reads: [],
    runtimeStateKeys: [],
    writes: ["artifacts", "recordingRefs"],
    writePolicy: "command-update",
    failureSemantics: "tool",
    observableSignals: ["state", "stream", "recording"],
    createMiddleware: () => createJingleExtensionAiToolsRuntimeMiddleware(options)
  })
}
