import { FileCode2, FileText, Link2, PackageOpen } from "lucide-react"
import type { BadgeProps } from "@/components/ui/badge"
import { isInlinePatchArtifactRecord, type ArtifactRecord } from "@shared/artifacts"

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
    return artifact.kind === "patch" ? "Inline diff" : "Inline artifact"
  }

  if (artifact.source.type === "external-url") {
    return getArtifactUriLabel(artifact.source.uri)
  }

  return artifact.source.uri.split(/[\\/]/).filter(Boolean).at(-1) ?? artifact.source.uri
}

export function getArtifactPreviewText(artifact: ArtifactRecord): string | null {
  switch (artifact.kind) {
    case "summary":
      return artifact.previewText ?? artifact.payload.text
    case "patch":
      return isInlinePatchArtifactRecord(artifact)
        ? (artifact.previewText ?? artifact.payload.text)
        : artifact.previewText
    case "link":
      return artifact.previewText ?? artifact.source.uri
    case "file":
      return artifact.previewText
  }
}

export function getArtifactStatusBadgeVariant(
  status: ArtifactRecord["status"]
): BadgeProps["variant"] {
  switch (status) {
    case "ready":
      return "nominal"
    case "missing":
      return "critical"
    case "stale":
      return "warning"
  }
}

export function getArtifactStatusLabel(status: ArtifactRecord["status"]): string {
  switch (status) {
    case "ready":
      return "Ready"
    case "missing":
      return "Missing"
    case "stale":
      return "Stale"
  }
}

export function getArtifactStatusDescription(status: ArtifactRecord["status"]): string {
  switch (status) {
    case "ready":
      return "Artifact content is available."
    case "missing":
      return "Artifact content is no longer available."
    case "stale":
      return "Artifact content may be out of date."
  }
}

export function getArtifactDescriptor(artifact: ArtifactRecord): {
  icon: typeof FileText
  label: string
  location: string
  preview: string | null
} {
  switch (artifact.kind) {
    case "summary":
      return {
        icon: FileText,
        label: "Summary",
        location: getArtifactLocation(artifact),
        preview: getArtifactPreviewText(artifact)
      }
    case "link":
      return {
        icon: Link2,
        label: "Link",
        location: getArtifactLocation(artifact),
        preview: getArtifactPreviewText(artifact)
      }
    case "patch":
      return {
        icon: FileCode2,
        label: "Patch",
        location: getArtifactLocation(artifact),
        preview: getArtifactPreviewText(artifact)
      }
    case "file":
      return {
        icon: PackageOpen,
        label: "File",
        location: getArtifactLocation(artifact),
        preview: getArtifactPreviewText(artifact)
      }
  }
}

export function getArtifactUrlMetadata(uri: string): {
  displayPath: string
  hostname: string | null
  origin: string | null
} {
  try {
    const url = new URL(uri)
    const displayPath = `${url.pathname}${url.search}${url.hash}` || "/"

    return {
      displayPath,
      hostname: url.hostname,
      origin: url.origin
    }
  } catch {
    return {
      displayPath: uri,
      hostname: null,
      origin: null
    }
  }
}

function getArtifactUriLabel(uri: string): string {
  return getArtifactUrlMetadata(uri).hostname ?? uri.split(/[\\/]/).filter(Boolean).at(-1) ?? uri
}
