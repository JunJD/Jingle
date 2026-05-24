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
    <div className="markdown-viewer-surface flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)] border-b border-border bg-background/50 px-[var(--ow-space-4)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-muted-foreground">
        <span className="truncate">{filePath}</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{lineCount} lines</span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground/70">markdown</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[var(--ow-chat-thread-max-width)] px-[var(--ow-space-6)] py-[var(--ow-chat-thread-y)]">
          <div className="rounded-2xl border border-border/70 bg-background-elevated px-[var(--ow-space-7)] py-[var(--ow-space-6)]">
            <MessageResponse className="min-w-0 max-w-none [font-size:var(--ow-font-reading)] leading-[var(--ow-line-reading)] text-foreground">
              {content}
            </MessageResponse>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
