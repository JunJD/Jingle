import { useEffect, useState } from "react"
import { Brain, Check, X } from "lucide-react"
import type { OpenworkMemorySuggestionRecord } from "@shared/openwork-memory"
import { useI18n } from "@/lib/i18n"

interface MemoryReviewPanelProps {
  threadId: string
}

export function MemoryReviewPanel(props: MemoryReviewPanelProps): React.JSX.Element | null {
  const { threadId } = props
  const { copy } = useI18n()
  const [suggestions, setSuggestions] = useState<OpenworkMemorySuggestionRecord[]>([])

  const loadSuggestions = async (): Promise<void> => {
    const nextSuggestions = await window.api.memory.listSuggestions({
      status: "pending",
      threadId
    })
    setSuggestions(nextSuggestions)
  }

  useEffect(() => {
    void loadSuggestions()
  }, [threadId])

  const acceptSuggestion = async (suggestionId: string): Promise<void> => {
    await window.api.memory.acceptSuggestion(suggestionId)
    await loadSuggestions()
  }

  const rejectSuggestion = async (suggestionId: string): Promise<void> => {
    await window.api.memory.rejectSuggestion(suggestionId)
    await loadSuggestions()
  }

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="border-t border-border pt-[var(--ow-space-4)]">
      <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-label)] font-semibold text-foreground">
        <Brain className="size-[var(--ow-icon-sm)] text-muted-foreground" />
        {copy.chat.pendingMemoryTitle}
      </div>
      <div className="mt-[var(--ow-space-3)] grid gap-[var(--ow-space-2)]">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.suggestionId}
            className="rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-2)]"
          >
            <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-foreground">
              {suggestion.content}
            </div>
            {suggestion.reason ? (
              <div className="mt-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
                {suggestion.reason}
              </div>
            ) : null}
            <div className="mt-[var(--ow-space-2)] flex items-center gap-[var(--ow-gap-sm)]">
              <button
                type="button"
                className="inline-flex min-h-[var(--ow-control-h-sm)] items-center gap-[var(--ow-space-1)] rounded-[var(--ow-radius-sm)] border border-border bg-background px-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-foreground transition hover:bg-background-secondary"
                onClick={() => {
                  void acceptSuggestion(suggestion.suggestionId)
                }}
              >
                <Check className="size-[var(--ow-icon-xs)]" />
                {copy.chat.pendingMemoryAccept}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[var(--ow-control-h-sm)] items-center gap-[var(--ow-space-1)] rounded-[var(--ow-radius-sm)] border border-border bg-background px-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-muted-foreground transition hover:bg-background-secondary hover:text-foreground"
                onClick={() => {
                  void rejectSuggestion(suggestion.suggestionId)
                }}
              >
                <X className="size-[var(--ow-icon-xs)]" />
                {copy.chat.pendingMemoryReject}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
