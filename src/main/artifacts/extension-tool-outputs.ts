import {
  getToolCallArtifactKey,
} from "@shared/artifacts"
import type { JingleAgentStateArtifactsUpdate } from "@jingle/langchain-agent-harness/transitional"
import type { ExtensionToolOutput } from "@shared/extension-sources"
import { toJingleAgentStateArtifactsUpdate } from "./agent-state-artifacts"
import { resolveExtensionToolOutputs } from "./present-artifact-tool-parser"
import { presentArtifacts } from "./service"

export async function presentExtensionToolOutputs(input: {
  outputs: ExtensionToolOutput[]
  runId: string | null
  threadId: string
  toolCallId: string
  workspacePath: string
}): Promise<JingleAgentStateArtifactsUpdate> {
  const parsedArtifacts = await resolveExtensionToolOutputs(input.outputs, input.workspacePath)
  const result = await presentArtifacts({
    artifacts: parsedArtifacts.map((artifact, index) => ({
      ...artifact,
      artifactKey: getToolCallArtifactKey(input.toolCallId, index)
    })),
    idempotencyKey: input.toolCallId,
    runId: input.runId,
    threadId: input.threadId,
    toolCallId: input.toolCallId
  })

  if (result.type === "idempotency-conflict") {
    throw new Error("Extension tool output presentation was retried with different content.")
  }

  return toJingleAgentStateArtifactsUpdate(result)
}
