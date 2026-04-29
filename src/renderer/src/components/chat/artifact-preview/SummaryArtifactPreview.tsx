import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageResponse } from "../message"
import type { SummaryArtifactRecord } from "@shared/artifacts"

interface SummaryArtifactPreviewProps {
  artifact: SummaryArtifactRecord
}

export function SummaryArtifactPreview(props: SummaryArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props
  const lineCount = artifact.payload.text.split("\n").length
  const isMarkdown = artifact.payload.format === "markdown"

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-[var(--ow-chat-artifact-max-w)] flex-col gap-[var(--ow-space-5)] px-[var(--ow-space-6)] py-[var(--ow-space-6)]">
        <div className="flex flex-wrap items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-meta)] text-muted-foreground">
          <Badge variant="outline">{isMarkdown ? "Markdown summary" : "Plain summary"}</Badge>
          <span>{lineCount} lines</span>
        </div>

        <div className="rounded-[var(--ow-radius-dialog)] border border-border/70 bg-background-elevated/80 px-[var(--ow-space-6)] py-[var(--ow-space-6)] shadow-[0_1px_0_rgba(255,255,255,0.03)]">
          {isMarkdown ? (
            <MessageResponse className="min-w-0 max-w-none [font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)] text-foreground">
              {artifact.payload.text}
            </MessageResponse>
          ) : (
            <div className="whitespace-pre-wrap break-words [font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)] text-foreground">
              {artifact.payload.text}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
