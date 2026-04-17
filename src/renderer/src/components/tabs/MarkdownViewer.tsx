import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageResponse } from "@/components/chat/message"

interface MarkdownViewerProps {
  filePath: string
  content: string
}

export function MarkdownViewer(props: MarkdownViewerProps): React.JSX.Element {
  const { content, filePath } = props
  const lineCount = content.split("\n").length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/50 px-4 py-2 text-xs text-muted-foreground">
        <span className="truncate">{filePath}</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{lineCount} lines</span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground/70">markdown</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <div className="rounded-2xl border border-border/70 bg-background-elevated px-7 py-6">
            <MessageResponse className="min-w-0 max-w-none text-[15px] leading-7 text-foreground">
              {content}
            </MessageResponse>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
