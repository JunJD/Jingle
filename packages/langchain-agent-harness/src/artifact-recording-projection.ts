import type { JingleAgentStateArtifactsUpdate } from "./artifact-state"
import type { RuntimeRecordingRef } from "./runtime-state"

export function projectJingleArtifactRecordingRefs(input: {
  update: JingleAgentStateArtifactsUpdate
}): RuntimeRecordingRef[] {
  const presentedAtByArtifactId = new Map<string, string>()

  for (const presentation of input.update.presentations ?? []) {
    for (const receipt of presentation.receipts) {
      presentedAtByArtifactId.set(receipt.artifactId, presentation.presentedAt)
    }
  }

  return (input.update.manifests ?? []).map((manifest) => {
    const presentedAt = presentedAtByArtifactId.get(manifest.artifactId)
    if (!presentedAt) {
      throw new Error(
        `Artifact recording ref requires a presentation receipt for ${manifest.artifactId}.`
      )
    }

    return {
      createdAt: presentedAt,
      domain: "artifact",
      path: null,
      refId: manifest.artifactId,
      runId: manifest.runId,
      threadId: manifest.threadId
    }
  })
}
