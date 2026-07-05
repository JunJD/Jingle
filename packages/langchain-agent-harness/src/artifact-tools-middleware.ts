import { createMiddleware, tool, type AgentMiddleware, type ToolRuntime } from "langchain"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import {
  buildJingleToolResultUpdateCommand,
  getRunIdFromToolRuntime,
  getToolCallIdFromToolRuntime
} from "./tool-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"
import { jingleAgentArtifactsStateSchema } from "./artifact-state"
import { projectJingleArtifactRecordingRefs } from "./artifact-recording-projection"
import type {
  RuntimeArtifactPresentationConfig,
  RuntimeArtifactPresentationContext,
  RuntimeArtifactPresentationResult
} from "./runtime-contract"

export type JingleArtifactPresentationContext = RuntimeArtifactPresentationContext
export type JingleArtifactPresentationResult = RuntimeArtifactPresentationResult
export type CreateJingleArtifactToolsHookOptions = RuntimeArtifactPresentationConfig

const PRESENT_ARTIFACTS_TOOL_NAME = "present_artifacts"

const presentArtifactsSchema = {
  additionalProperties: false,
  properties: {
    artifacts: {
      items: {
        additionalProperties: true,
        properties: {
          dedupeKey: { type: "string" },
          kind: {
            enum: ["file", "patch", "link", "summary"],
            type: "string"
          },
          subtitle: { type: "string" },
          title: { type: "string" }
        },
        required: ["kind"],
        type: "object"
      },
      minItems: 1,
      type: "array"
    }
  },
  required: ["artifacts"],
  type: "object"
} as const

export type JingleArtifactToolsRuntimeMiddleware = AgentMiddleware<
  typeof jingleAgentArtifactsStateSchema,
  undefined,
  unknown,
  readonly [ReturnType<typeof createPresentArtifactsTool>]
>

function createPresentArtifactsTool(options: CreateJingleArtifactToolsHookOptions) {
  return tool(
    async (input, runtime: ToolRuntime) => {
      const toolCallId = getToolCallIdFromToolRuntime(runtime)
      if (!toolCallId) {
        throw new Error("Artifact presentation requires a tool call id.")
      }

      const result = await options.presentArtifacts(input, {
        runId: getRunIdFromToolRuntime(runtime),
        toolCallId
      })

      return buildJingleToolResultUpdateCommand({
        toolResult: {
          content: result.content,
          name: PRESENT_ARTIFACTS_TOOL_NAME,
          toolCallId
        },
        update: {
          artifacts: result.update,
          recordingRefs: projectJingleArtifactRecordingRefs({
            update: result.update
          })
        }
      })
    },
    {
      description:
        "Present user-visible results to the Artifacts panel. Use this for deliverables like workspace files, patches, links, and summaries after they are ready for the user. Do not use this for every intermediate edit or log.",
      name: PRESENT_ARTIFACTS_TOOL_NAME,
      schema: presentArtifactsSchema
    }
  )
}

function createJingleArtifactToolsRuntimeMiddleware(
  options: CreateJingleArtifactToolsHookOptions
): JingleArtifactToolsRuntimeMiddleware {
  const presentArtifactsTool = createPresentArtifactsTool(options)

  return createMiddleware({
    name: "jingleArtifactTools",
    stateSchema: jingleAgentArtifactsStateSchema,
    tools: [presentArtifactsTool]
  })
}

export function createJingleArtifactToolsHook(
  options: CreateJingleArtifactToolsHookOptions
): RuntimeMiddlewareHook<JingleArtifactToolsRuntimeMiddleware> {
  return defineJingleHarnessHook({
    name: "artifacts",
    phase: "agent_loop",
    adapterStateKeys: [],
    reads: [],
    runtimeStateKeys: [],
    writes: ["artifacts", "recordingRefs"],
    writePolicy: "command-update",
    failureSemantics: "tool",
    observableSignals: ["state", "stream", "recording"],
    createMiddleware: () => createJingleArtifactToolsRuntimeMiddleware(options)
  })
}
