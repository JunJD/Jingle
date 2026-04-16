import { Copy, ExternalLink, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LinkArtifactRecord } from "@shared/artifacts"

interface LinkArtifactPreviewProps {
  artifact: LinkArtifactRecord
  onCopyLink: () => void
  onOpenLink: () => void
}

export function LinkArtifactPreview(props: LinkArtifactPreviewProps): React.JSX.Element {
  const { artifact, onCopyLink, onOpenLink } = props

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full flex-col items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-background-elevated/70 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            <Link2 className="size-3.5" />
            External link
          </div>
          <div className="mt-4 break-all text-sm leading-6 text-foreground">
            {artifact.source.uri}
          </div>
          <div className="mt-5 flex gap-2">
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
