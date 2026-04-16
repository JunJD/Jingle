import { useCallback } from "react"
import { Copy, ExternalLink, FolderOpen, PackageOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCurrentThread } from "@/lib/thread-context"
import {
  getArtifactCapabilities,
  supportsArtifactAction,
  type ArtifactActionId,
  type ArtifactRecord,
  type FileArtifactRecord,
  type InlinePatchArtifactRecord,
  type ManagedPatchArtifactRecord
} from "@shared/artifacts"
import { FileArtifactPreview } from "@/components/chat/artifact-preview/FileArtifactPreview"
import { LinkArtifactPreview } from "@/components/chat/artifact-preview/LinkArtifactPreview"
import { PatchArtifactPreview } from "@/components/chat/artifact-preview/PatchArtifactPreview"
import { SummaryArtifactPreview } from "@/components/chat/artifact-preview/SummaryArtifactPreview"
import {
  getArtifactKindLabel,
  getArtifactLocation
} from "@/components/chat/artifact-preview/shared"

interface ArtifactViewerProps {
  artifactId: string
  threadId: string
}

function isManagedFileArtifact(
  artifact: ArtifactRecord
): artifact is FileArtifactRecord | ManagedPatchArtifactRecord {
  return artifact.source.type === "managed-file-path"
}

function isInlinePatchArtifact(artifact: ArtifactRecord): artifact is InlinePatchArtifactRecord {
  return artifact.kind === "patch" && artifact.source.type === "inline-text"
}

export function ArtifactViewer(props: ArtifactViewerProps): React.JSX.Element {
  const { artifactId, threadId } = props
  const { artifacts } = useCurrentThread(threadId)
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
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Artifact not available
      </div>
    )
  }

  const currentArtifact = artifact
  const capabilities = getArtifactCapabilities(currentArtifact)

  function renderPreviewBody(): React.JSX.Element {
    if (currentArtifact.kind === "file") {
      return <FileArtifactPreview artifact={currentArtifact} />
    }

    if (currentArtifact.kind === "summary") {
      return <SummaryArtifactPreview artifact={currentArtifact} />
    }

    if (currentArtifact.kind === "patch") {
      if (isManagedFileArtifact(currentArtifact)) {
        return <FileArtifactPreview artifact={currentArtifact} />
      }

      if (isInlinePatchArtifact(currentArtifact)) {
        return <PatchArtifactPreview artifact={currentArtifact} />
      }
    }

    return (
      <LinkArtifactPreview
        artifact={currentArtifact}
        onCopyLink={() => void handleArtifactAction(currentArtifact.id, "copy-link")}
        onOpenLink={() => void handleArtifactAction(currentArtifact.id)}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-start gap-3 border-b border-border bg-background-elevated/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {currentArtifact.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{getArtifactKindLabel(currentArtifact)}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="truncate">{getArtifactLocation(currentArtifact)}</span>
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

      <div className="min-h-0 flex-1">{renderPreviewBody()}</div>
    </div>
  )
}
