import type { ArtifactRecord, FileArtifactRecord } from "@shared/artifacts"

function formatArtifactSize(bytes: number | null): string | null {
  if (bytes === null) {
    return null
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getArtifactExtension(artifact: ArtifactRecord): string | null {
  if (artifact.source.type !== "managed-file-path") {
    return null
  }

  const fileName = artifact.source.uri.split(/[\\/]/).at(-1)
  if (!fileName) {
    return null
  }

  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : null
  return extension ? extension.toUpperCase() : null
}

export function compareLauncherArtifactsByCreatedAt(
  left: ArtifactRecord,
  right: ArtifactRecord
): number {
  return right.createdAt.getTime() - left.createdAt.getTime()
}

export type LauncherImageArtifact = FileArtifactRecord & {
  mimeType: `image/${string}`
}

export function isLauncherImageArtifact(
  artifact: ArtifactRecord
): artifact is LauncherImageArtifact {
  if (artifact.kind !== "file" || artifact.source.type !== "managed-file-path") {
    return false
  }

  return artifact.mimeType?.startsWith("image/") === true
}

export type LauncherArtifactPreviewProjection =
  | { artifact: LauncherImageArtifact; kind: "image" }
  | { kind: "none" }
  | { kind: "unavailable"; reason: "missing-mime-type" }

export interface LauncherArtifactCardProjection {
  isOpenable: boolean
  meta: string
  preview: LauncherArtifactPreviewProjection
}

export function projectLauncherArtifactCard(
  artifact: ArtifactRecord
): LauncherArtifactCardProjection {
  const metaCandidates = [
    artifact.subtitle,
    artifact.previewText,
    formatArtifactSize(artifact.sizeBytes),
    artifact.mimeType,
    getArtifactExtension(artifact)
  ]
  const meta = metaCandidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
  )

  const base = {
    isOpenable: artifact.source.type !== "inline-text",
    meta: meta ?? artifact.kind
  }

  if (isLauncherImageArtifact(artifact)) {
    return { ...base, preview: { artifact, kind: "image" } }
  }

  if (artifact.kind === "file" && artifact.mimeType === null) {
    return { ...base, preview: { kind: "unavailable", reason: "missing-mime-type" } }
  }

  return { ...base, preview: { kind: "none" } }
}
