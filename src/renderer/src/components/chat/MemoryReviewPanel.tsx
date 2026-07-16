import { Brain, Check, Link2, X } from "lucide-react"
import type { JingleMemoryEvidenceRef, JingleMemorySuggestionRecord } from "@shared/jingle-memory"
import { readJingleMemoryEvidenceRefsFromReviewPayload } from "@shared/jingle-memory"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { useMemoryReviewController } from "./use-memory-review-controller"

interface MemoryReviewPanelProps {
  threadId: string
}

function readSuggestionEvidenceRefs(
  suggestion: JingleMemorySuggestionRecord
): JingleMemoryEvidenceRef[] {
  return readJingleMemoryEvidenceRefsFromReviewPayload(suggestion.reviewPayload)
}

function sourceLabel(sourceType: JingleMemoryEvidenceRef["sourceType"]): string {
  switch (sourceType) {
    case "memory":
      return "memory"
    case "context_file":
      return "context file"
    case "thread_digest":
      return "thread summary"
    case "history_message":
      return "history message"
    case "trace_step":
      return "trace step"
    case "artifact":
      return "artifact"
  }
}

export function MemoryReviewPanel(props: MemoryReviewPanelProps): React.JSX.Element | null {
  const { threadId } = props
  const { copy } = useI18n()
  const { acceptSuggestion, rejectSuggestion, suggestions } = useMemoryReviewController(threadId)

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="border-t border-border pt-[var(--jingle-space-4)]">
      <div className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-label)] font-semibold text-foreground">
        <Brain className="size-[var(--jingle-icon-sm)] text-muted-foreground" />
        {copy.chat.pendingMemoryTitle}
      </div>
      <div className="mt-[var(--jingle-space-3)] grid gap-[var(--jingle-space-2)]">
        {suggestions.map((suggestion) => {
          const evidenceRefs = readSuggestionEvidenceRefs(suggestion)

          return (
            <div
              key={suggestion.suggestionId}
              className="rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]"
            >
              <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-foreground">
                {suggestion.content}
              </div>
              {suggestion.reason ? (
                <div className="mt-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
                  {suggestion.reason}
                </div>
              ) : null}
              {evidenceRefs.length > 0 ? (
                <div className="mt-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] border border-border bg-background px-[var(--jingle-space-2)] py-[var(--jingle-space-2)]">
                  <div className="flex items-center gap-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] font-medium text-muted-foreground">
                    <Link2 className="size-[var(--jingle-icon-xs)]" />
                    {copy.chat.pendingMemoryEvidenceTitle(evidenceRefs.length)}
                  </div>
                  <div className="mt-[var(--jingle-space-2)] grid gap-[var(--jingle-space-1)]">
                    {evidenceRefs.map((ref) => (
                      <div key={ref.id} className="min-w-0">
                        <div className="truncate [font-size:var(--jingle-font-meta)] text-foreground">
                          {ref.title}
                        </div>
                        <div className="truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
                          {sourceLabel(ref.sourceType)} - {ref.preview}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-[var(--jingle-space-2)] flex items-center gap-[var(--jingle-gap-sm)]">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="inline-flex min-h-[var(--jingle-control-h-sm)] items-center gap-[var(--jingle-space-1)] rounded-[var(--jingle-radius-sm)] border border-border bg-background px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-foreground transition hover:bg-background-secondary"
                  onClick={() => {
                    void acceptSuggestion(suggestion.suggestionId)
                  }}
                >
                  <Check className="size-[var(--jingle-icon-xs)]" />
                  {copy.chat.pendingMemoryAccept}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="inline-flex min-h-[var(--jingle-control-h-sm)] items-center gap-[var(--jingle-space-1)] rounded-[var(--jingle-radius-sm)] border border-border bg-background px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-muted-foreground transition hover:bg-background-secondary hover:text-foreground"
                  onClick={() => {
                    void rejectSuggestion(suggestion.suggestionId)
                  }}
                >
                  <X className="size-[var(--jingle-icon-xs)]" />
                  {copy.chat.pendingMemoryReject}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
