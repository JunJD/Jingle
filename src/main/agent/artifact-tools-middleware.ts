import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { getToolCallArtifactKey } from "@shared/artifacts"
import { parsePresentArtifactToolInput } from "../artifacts/present-artifact-tool-parser"
import { presentArtifactToolInputSchema } from "../artifacts/present-artifact-tool-schema"
import { presentArtifacts } from "../artifacts/service"

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
      const runId =
        typeof runtime.configurable?.run_id === "string" ? runtime.configurable.run_id : null

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

      return summarizePresentation(
        result.artifacts.length,
        result.artifacts.map((artifact) => artifact.title)
      )
    },
    {
      description:
        "Present user-visible results to the Artifacts panel. Use this for deliverables like workspace files, patches, links, and summaries after they are ready for the user. Do not use this for every intermediate edit or log.",
      name: "present_artifacts",
      schema: presentArtifactToolInputSchema
    }
  )

  return createMiddleware({
    name: "openworkArtifactTools",
    tools: [presentArtifactsTool]
  })
}
