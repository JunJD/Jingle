import { useCallback } from "react"
import { AlertCircle, Copy, ExternalLink, FolderOpen, PackageOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/utils"
import { useThreadSelector } from "@/lib/thread-context"
import {
  getArtifactCapabilities,
  isInlinePatchArtifactRecord,
  isManagedArtifactRecord,
  supportsArtifactAction,
  type ArtifactActionId
} from "@shared/artifacts"
import type { ArtifactRecord } from "@shared/artifacts"
import { FileArtifactPreview } from "@/components/chat/artifact-preview/FileArtifactPreview"
import { LinkArtifactPreview } from "@/components/chat/artifact-preview/LinkArtifactPreview"
import { PatchArtifactPreview } from "@/components/chat/artifact-preview/PatchArtifactPreview"
import { SummaryArtifactPreview } from "@/components/chat/artifact-preview/SummaryArtifactPreview"
import {
  getArtifactDescriptor,
  getArtifactStatusDescription,
  getArtifactStatusBadgeVariant,
  getArtifactStatusLabel
} from "@/components/chat/artifact-preview/shared"

interface ArtifactViewerProps {
  artifactId: string
  threadId: string
}

const EMPTY_ARTIFACTS: readonly ArtifactRecord[] = []

function ArtifactPreviewBody(props: {
  artifact: ArtifactRecord
  onAction: (targetArtifactId: string, action?: ArtifactActionId) => void
}): React.JSX.Element {
  const { artifact, onAction } = props

  if (artifact.kind === "file") {
    return <FileArtifactPreview artifact={artifact} />
  }

  if (artifact.kind === "summary") {
    return <SummaryArtifactPreview artifact={artifact} />
  }

  if (artifact.kind === "patch") {
    if (isManagedArtifactRecord(artifact)) {
      return <FileArtifactPreview artifact={artifact} />
    }

    if (isInlinePatchArtifactRecord(artifact)) {
      return <PatchArtifactPreview artifact={artifact} />
    }
  }

  return (
    <LinkArtifactPreview
      artifact={artifact}
      onCopyLink={() => onAction(artifact.id, "copy-link")}
      onOpenLink={() => onAction(artifact.id)}
    />
  )
}

export function ArtifactViewer(props: ArtifactViewerProps): React.JSX.Element {
  const { artifactId, threadId } = props
  const artifacts = useThreadSelector(
    threadId,
    (state) => state?.agent.artifacts ?? EMPTY_ARTIFACTS
  )
  const artifact = artifacts.find((entry) => entry.id === artifactId) ?? null

  const handleArtifactAction = useCallback(
    async (targetArtifactId: string, action?: ArtifactActionId) => {
      const resolution = await window.api.artifacts.open(targetArtifactId, action)

      if (resolution.type === "copy-link") {
        await navigator.clipboard.writeText(resolution.value)
      }
    },
    []
  )

  if (!artifact) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-8"
        data-artifact-viewer-unavailable="true"
      >
        <div className="flex max-w-md flex-col items-center gap-3 rounded-[20px] border border-border bg-background-elevated/70 px-6 py-7 text-center">
          <AlertCircle className="size-10 text-status-critical" />
          <div>
            <div className="font-medium text-foreground">Artifact not available</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              This artifact is no longer available in the current thread snapshot.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const currentArtifact = artifact
  const capabilities = getArtifactCapabilities(currentArtifact)
  const descriptor = getArtifactDescriptor(currentArtifact)
  const statusLabel = getArtifactStatusLabel(currentArtifact.status)
  const statusDescription = getArtifactStatusDescription(currentArtifact.status)

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-artifact-id={currentArtifact.id}
      data-artifact-kind={currentArtifact.kind}
      data-artifact-status={currentArtifact.status}
      data-artifact-title={currentArtifact.title}
      data-artifact-viewer=""
    >
      <div className="flex items-start gap-3 border-b border-border bg-background-elevated/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {currentArtifact.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              className="shrink-0"
              variant={getArtifactStatusBadgeVariant(currentArtifact.status)}
            >
              {statusLabel}
            </Badge>
            <span>{descriptor.label}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="truncate">{descriptor.location}</span>
            {currentArtifact.sizeBytes ? (
              <>
                <span className="text-muted-foreground/50">•</span>
                <span>{formatBytes(currentArtifact.sizeBytes)}</span>
              </>
            ) : null}
            <span className="text-muted-foreground/50">•</span>
            <span>Updated {formatRelativeTime(currentArtifact.updatedAt)}</span>
          </div>
          {currentArtifact.subtitle ? (
            <div className="mt-1 text-xs text-muted-foreground">{currentArtifact.subtitle}</div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {supportsArtifactAction(currentArtifact, "copy-link") ? (
            <Button
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => void handleArtifactAction(currentArtifact.id, "copy-link")}
              size="sm"
              variant="ghost"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          ) : null}

          {supportsArtifactAction(currentArtifact, "reveal-source") ? (
            <Button
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => void handleArtifactAction(currentArtifact.id, "reveal-source")}
              size="sm"
              variant="ghost"
            >
              <FolderOpen className="size-3.5" />
              Reveal
            </Button>
          ) : null}

          {capabilities.primaryAction === "open" ? (
            <Button
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => void handleArtifactAction(currentArtifact.id)}
              size="sm"
              variant="ghost"
            >
              {currentArtifact.kind === "link" ? (
                <ExternalLink className="size-3.5" />
              ) : (
                <PackageOpen className="size-3.5" />
              )}
              Open
            </Button>
          ) : null}
        </div>
      </div>

      {currentArtifact.status !== "ready" ? (
        <div className="border-b border-border bg-background px-4 py-3">
          <div className="flex items-start gap-3 rounded-[16px] border border-border/80 bg-background-secondary/60 px-4 py-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-warning" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{statusLabel} artifact</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {statusDescription}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <ArtifactPreviewBody
          artifact={currentArtifact}
          onAction={(targetArtifactId, action) =>
            void handleArtifactAction(targetArtifactId, action)
          }
        />
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
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
