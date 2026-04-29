import { Badge } from "@/components/ui/badge"
import { Copy, ExternalLink, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LinkArtifactRecord } from "@shared/artifacts"
import { getArtifactUrlMetadata } from "./shared"

interface LinkArtifactPreviewProps {
  artifact: LinkArtifactRecord
  onCopyLink: () => void
  onOpenLink: () => void
}

export function LinkArtifactPreview(props: LinkArtifactPreviewProps): React.JSX.Element {
  const { artifact, onCopyLink, onOpenLink } = props
  const urlMetadata = getArtifactUrlMetadata(artifact.source.uri)

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--ow-chat-artifact-max-w)] items-center px-[var(--ow-space-6)] py-[var(--ow-space-6)]">
        <div className="w-full rounded-[var(--ow-radius-dialog)] border border-border bg-background-elevated/80 p-[var(--ow-space-6)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--ow-gap-lg)]">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-meta)] uppercase tracking-[0.12em] text-muted-foreground">
                <Link2 className="size-[var(--ow-icon-sm)]" />
                External link
              </div>
              <div className="mt-[var(--ow-space-3)] [font-size:var(--ow-font-display)] font-semibold text-foreground">
                {artifact.title}
              </div>
              {artifact.subtitle ? (
                <div className="mt-[var(--ow-space-1)] [font-size:var(--ow-font-body)] text-muted-foreground">
                  {artifact.subtitle}
                </div>
              ) : null}
            </div>
            {urlMetadata.hostname ? <Badge variant="outline">{urlMetadata.hostname}</Badge> : null}
          </div>

          {artifact.previewText ? (
            <div className="mt-[var(--ow-space-5)] rounded-[var(--ow-radius-dialog)] border border-border/70 bg-background-secondary/60 px-[var(--ow-space-4)] py-[var(--ow-space-3)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground/85">
              {artifact.previewText}
            </div>
          ) : null}

          <div className="mt-[var(--ow-space-5)] grid gap-[var(--ow-gap-lg)] rounded-[var(--ow-radius-dialog)] border border-border/70 bg-background-secondary/40 px-[var(--ow-space-4)] py-[var(--ow-space-4)] [font-size:var(--ow-font-body)]">
            <div>
              <div className="[font-size:var(--ow-font-meta)] uppercase tracking-[0.08em] text-muted-foreground">
                URL
              </div>
              <div className="mt-[var(--ow-space-1)] break-all leading-[var(--ow-line-chat)] text-foreground">
                {artifact.source.uri}
              </div>
            </div>
            {urlMetadata.origin ? (
              <div className="grid gap-[var(--ow-gap-md)] sm:grid-cols-2">
                <div>
                  <div className="[font-size:var(--ow-font-meta)] uppercase tracking-[0.08em] text-muted-foreground">
                    Origin
                  </div>
                  <div className="mt-[var(--ow-space-1)] break-all leading-[var(--ow-line-chat)] text-foreground">
                    {urlMetadata.origin}
                  </div>
                </div>
                <div>
                  <div className="[font-size:var(--ow-font-meta)] uppercase tracking-[0.08em] text-muted-foreground">
                    Path
                  </div>
                  <div className="mt-[var(--ow-space-1)] break-all leading-[var(--ow-line-chat)] text-foreground">
                    {urlMetadata.displayPath}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-[var(--ow-space-5)] flex flex-wrap gap-[var(--ow-gap-sm)]">
            <Button
              className="gap-[var(--ow-gap-xs)]"
              onClick={onCopyLink}
              size="sm"
              variant="outline"
            >
              <Copy className="size-[var(--ow-icon-sm)]" />
              Copy link
            </Button>
            <Button className="gap-[var(--ow-gap-xs)]" onClick={onOpenLink} size="sm">
              <ExternalLink className="size-[var(--ow-icon-sm)]" />
              Open link
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
