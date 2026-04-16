import type { ArtifactRecord } from "@shared/artifacts"

export function getArtifactKindLabel(artifact: ArtifactRecord): string {
  switch (artifact.kind) {
    case "file":
      return "File"
    case "link":
      return "Link"
    case "patch":
      return "Patch"
    case "summary":
      return "Summary"
  }
}

export function getArtifactLocation(artifact: ArtifactRecord): string {
  if (artifact.source.type === "inline-text") {
    return "Inline artifact"
  }

  if (artifact.source.type === "external-url") {
    return artifact.source.uri
  }

  return artifact.source.uri.split(/[\\/]/).filter(Boolean).at(-1) ?? artifact.source.uri
}
