import { useCallback, useEffect, useState } from "react"
import type { ArtifactRecord } from "@shared/artifacts"
import { artifactRendererCommands } from "@/lib/artifact-renderer-commands"
import type { LauncherImageArtifact } from "./launcher-ai-artifact-projection"

export type LauncherArtifactImagePreviewState =
  | { status: "error" }
  | { src: string; status: "ready" }
  | { status: "loading" }

export function useLauncherAiArtifactController(): {
  openArtifact: (artifact: ArtifactRecord) => Promise<void>
} {
  const openArtifact = useCallback(async (artifact: ArtifactRecord): Promise<void> => {
    await artifactRendererCommands.openArtifact(artifact.id)
  }, [])

  return { openArtifact }
}

export function useLauncherArtifactImagePreview(
  artifact: LauncherImageArtifact
): LauncherArtifactImagePreviewState {
  const [preview, setPreview] = useState<LauncherArtifactImagePreviewState>({ status: "loading" })

  useEffect(() => {
    let active = true

    void window.api.artifacts
      .readBinaryFile(artifact.id)
      .then((result) => {
        if (!active) {
          return
        }

        if (!result.success || !result.content) {
          setPreview({ status: "error" })
          return
        }

        setPreview({
          src: `data:${artifact.mimeType};base64,${result.content}`,
          status: "ready"
        })
      })
      .catch(() => {
        if (active) {
          setPreview({ status: "error" })
        }
      })

    return () => {
      active = false
    }
  }, [artifact.id, artifact.mimeType])

  return preview
}
