import {
  getToolCallArtifactKey,
  toAgentStateArtifactsUpdate,
  type AgentStateArtifactsUpdate
} from "@shared/artifacts"
import type { ExtensionToolOutput } from "@shared/extension-sources"
import { resolveExtensionToolOutputs } from "./present-artifact-tool-parser"
import { presentArtifacts } from "./service"

export async function presentExtensionToolOutputs(input: {
  outputs: ExtensionToolOutput[]
  runId: string | null
  threadId: string
  toolCallId: string
  workspacePath: string
}): Promise<AgentStateArtifactsUpdate> {
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

  return toAgentStateArtifactsUpdate(result)
}
