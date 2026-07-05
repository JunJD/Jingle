import type {
  JingleAgentStateArtifactManifest,
  JingleAgentStateArtifactsUpdate
} from "@jingle/langchain-agent-harness/transitional"
import type { ArtifactRecord, PresentArtifactsStoredResult } from "@shared/artifacts"

export function toJingleAgentStateArtifactManifest(
  artifact: ArtifactRecord
): JingleAgentStateArtifactManifest {
  return {
    artifactId: artifact.id,
    artifactKey: artifact.artifactKey,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    runId: artifact.runId,
    sizeBytes: artifact.sizeBytes,
    sourceType: artifact.source.type,
    status: artifact.status,
    threadId: artifact.threadId,
    title: artifact.title,
    toolCallId: artifact.toolCallId,
    updatedAt: artifact.updatedAt.toISOString()
  }
}

export function toJingleAgentStateArtifactsUpdate(
  result: PresentArtifactsStoredResult,
  presentedAt = new Date()
): JingleAgentStateArtifactsUpdate {
  return {
    manifests: result.artifacts.map(toJingleAgentStateArtifactManifest),
    presentations: [
      {
        idempotencyKey: result.requestIdentity.idempotencyKey,
        presentedAt: presentedAt.toISOString(),
        receipts: result.receipts,
        resultType: result.type,
        threadId: result.requestIdentity.threadId,
        toolCallId: result.artifacts[0]?.toolCallId ?? null
      }
    ]
  }
}
