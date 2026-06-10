import { ToolMessage } from "@langchain/core/messages"
import { Command, ReducedValue, StateSchema } from "@langchain/langgraph"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  ARTIFACT_WRITE_OUTCOMES,
  getToolCallArtifactKey,
  reduceAgentStateArtifacts,
  toAgentStateArtifactsUpdate
} from "@shared/artifacts"
import { extensionToolOutputEnvelopeSchema } from "@shared/extension-sources"
import { getRunIdFromToolRuntime } from "./run-config"
import { parsePresentArtifactToolInput } from "../artifacts/present-artifact-tool-parser"
import { presentArtifacts } from "../artifacts/service"

const artifactPresentationReceiptSchema = z.object({
  artifactId: z.string(),
  artifactKey: z.string(),
  dedupeKey: z.string().nullable(),
  outcome: z.enum(ARTIFACT_WRITE_OUTCOMES)
})

const agentStateArtifactManifestSchema = z.object({
  artifactId: z.string(),
  artifactKey: z.string(),
  kind: z.enum(ARTIFACT_KINDS),
  mimeType: z.string().nullable(),
  runId: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sourceType: z.enum(["managed-file-path", "external-url", "inline-text"]),
  status: z.enum(ARTIFACT_STATUSES),
  threadId: z.string(),
  title: z.string(),
  toolCallId: z.string().nullable(),
  updatedAt: z.string()
})

const agentStateArtifactPresentationSchema = z.object({
  idempotencyKey: z.string(),
  presentedAt: z.string(),
  receipts: z.array(artifactPresentationReceiptSchema),
  resultType: z.enum(["stored", "replayed"]),
  threadId: z.string(),
  toolCallId: z.string().nullable()
})

const agentStateArtifactsSnapshotSchema = z
  .object({
    manifestsById: z.record(z.string(), agentStateArtifactManifestSchema).default(() => ({})),
    presentationsByIdempotencyKey: z
      .record(z.string(), agentStateArtifactPresentationSchema)
      .default(() => ({}))
  })
  .strict()

const agentStateArtifactsSchema = agentStateArtifactsSnapshotSchema
  .default(() => ({
    manifestsById: {},
    presentationsByIdempotencyKey: {}
  }))

const agentStateArtifactsUpdateSchema = z
  .union([
    z
      .object({
        manifests: z.array(agentStateArtifactManifestSchema).optional(),
        presentations: z.array(agentStateArtifactPresentationSchema).optional()
      })
      .strict(),
    agentStateArtifactsSnapshotSchema
  ])
  .optional()

const artifactStateSchema = new StateSchema({
  artifacts: new ReducedValue(agentStateArtifactsSchema, {
    inputSchema: agentStateArtifactsUpdateSchema,
    reducer: reduceAgentStateArtifacts
  })
})

function summarizePresentation(count: number, titles: string[]): string {
  if (count === 1) {
    return `Presented artifact: ${titles[0] ?? "Untitled"}`
  }

  const preview = titles.slice(0, 3).join(", ")
  return count > 3
    ? `Presented ${count} artifacts: ${preview}, ...`
    : `Presented ${count} artifacts: ${preview}`
}

export function createArtifactToolsMiddleware(props: { threadId: string; workspacePath: string }) {
  const presentArtifactsTool = tool(
    async (input, runtime: ToolRuntime) => {
      const parsedArtifacts = await parsePresentArtifactToolInput(input, props.workspacePath)
      const toolCallId = runtime.toolCallId
      const runId = getRunIdFromToolRuntime(runtime)

      const result = await presentArtifacts({
        artifacts: parsedArtifacts.map((artifact, index) => ({
          ...artifact,
          artifactKey: getToolCallArtifactKey(toolCallId, index)
        })),
        idempotencyKey: toolCallId,
        runId,
        threadId: props.threadId,
        toolCallId
      })

      if (result.type === "idempotency-conflict") {
        throw new Error("present_artifacts retried with different content for the same tool call.")
      }

      const content = summarizePresentation(
        result.artifacts.length,
        result.artifacts.map((artifact) => artifact.title)
      )
      return new Command({
        update: {
          artifacts: toAgentStateArtifactsUpdate(result),
          messages: [
            new ToolMessage({
              content,
              name: "present_artifacts",
              tool_call_id: toolCallId
            })
          ]
        }
      })
    },
    {
      description:
        "Present user-visible results to the Artifacts panel. Use this for deliverables like workspace files, patches, links, and summaries after they are ready for the user. Do not use this for every intermediate edit or log.",
      name: "present_artifacts",
      schema: extensionToolOutputEnvelopeSchema
    }
  )

  return createMiddleware({
    name: "openworkArtifactTools",
    stateSchema: artifactStateSchema,
    tools: [presentArtifactsTool]
  })
}
