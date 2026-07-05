import { getToolCallArtifactKey } from "@shared/artifacts"
import {
  type RuntimeArtifactPresentationConfig,
  type RuntimeArtifactPresentationContext
} from "@jingle/langchain-agent-harness"
import { toJingleAgentStateArtifactsUpdate } from "../artifacts/agent-state-artifacts"
import { parsePresentArtifactToolInput } from "../artifacts/present-artifact-tool-parser"
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

export function createArtifactPresentationHandler(props: {
  threadId: string
  workspacePath: string
}): RuntimeArtifactPresentationConfig["presentArtifacts"] {
  return async (input, context: RuntimeArtifactPresentationContext) => {
    const parsedArtifacts = await parsePresentArtifactToolInput(input, props.workspacePath)
    const result = await presentArtifacts({
      artifacts: parsedArtifacts.map((artifact, index) => ({
        ...artifact,
        artifactKey: getToolCallArtifactKey(context.toolCallId, index)
      })),
      idempotencyKey: context.toolCallId,
      runId: context.runId,
      threadId: props.threadId,
      toolCallId: context.toolCallId
    })

    if (result.type === "idempotency-conflict") {
      throw new Error("present_artifacts retried with different content for the same tool call.")
    }

    const content = summarizePresentation(
      result.artifacts.length,
      result.artifacts.map((artifact) => artifact.title)
    )
    return {
      content,
      update: toJingleAgentStateArtifactsUpdate(result)
    }
  }
}
