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
      <div className="mx-auto flex min-h-full w-full max-w-4xl items-center px-6 py-8">
        <div className="w-full rounded-[24px] border border-border bg-background-elevated/80 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <Link2 className="size-3.5" />
                External link
              </div>
              <div className="mt-3 text-lg font-semibold text-foreground">{artifact.title}</div>
              {artifact.subtitle ? (
                <div className="mt-1 text-sm text-muted-foreground">{artifact.subtitle}</div>
              ) : null}
            </div>
            {urlMetadata.hostname ? <Badge variant="outline">{urlMetadata.hostname}</Badge> : null}
          </div>

          {artifact.previewText ? (
            <div className="mt-5 rounded-[16px] border border-border/70 bg-background-secondary/60 px-4 py-3 text-sm leading-6 text-foreground/85">
              {artifact.previewText}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 rounded-[16px] border border-border/70 bg-background-secondary/40 px-4 py-4 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                URL
              </div>
              <div className="mt-1 break-all leading-6 text-foreground">{artifact.source.uri}</div>
            </div>
            {urlMetadata.origin ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    Origin
                  </div>
                  <div className="mt-1 break-all leading-6 text-foreground">
                    {urlMetadata.origin}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    Path
                  </div>
                  <div className="mt-1 break-all leading-6 text-foreground">
                    {urlMetadata.displayPath}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button className="gap-1" onClick={onCopyLink} size="sm" variant="outline">
              <Copy className="size-3.5" />
              Copy link
            </Button>
            <Button className="gap-1" onClick={onOpenLink} size="sm">
              <ExternalLink className="size-3.5" />
              Open link
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
