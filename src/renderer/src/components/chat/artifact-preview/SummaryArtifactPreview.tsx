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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{isMarkdown ? "Markdown summary" : "Plain summary"}</Badge>
          <span>{lineCount} lines</span>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-background-elevated/80 px-7 py-6 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
          {isMarkdown ? (
            <MessageResponse className="min-w-0 max-w-none text-[15px] leading-7 text-foreground">
              {artifact.payload.text}
            </MessageResponse>
          ) : (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">
              {artifact.payload.text}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
