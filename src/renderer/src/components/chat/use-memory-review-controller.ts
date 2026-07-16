import { useCallback, useEffect, useState } from "react"
import type { JingleMemorySuggestionRecord } from "@shared/jingle-memory"

async function readPendingMemorySuggestions(
  threadId: string
): Promise<JingleMemorySuggestionRecord[]> {
  return window.api.memory.listSuggestions({
    status: "pending",
    threadId
  })
}

export function useMemoryReviewController(threadId: string): {
  acceptSuggestion: (suggestionId: string) => Promise<void>
  rejectSuggestion: (suggestionId: string) => Promise<void>
  suggestions: JingleMemorySuggestionRecord[]
} {
  const [suggestions, setSuggestions] = useState<JingleMemorySuggestionRecord[]>([])

  const loadSuggestions = useCallback(async (): Promise<void> => {
    setSuggestions(await readPendingMemorySuggestions(threadId))
  }, [threadId])

  useEffect(() => {
    let active = true

    void readPendingMemorySuggestions(threadId).then((nextSuggestions) => {
      if (active) {
        setSuggestions(nextSuggestions)
      }
    })

    return () => {
      active = false
    }
  }, [threadId])

  const acceptSuggestion = useCallback(
    async (suggestionId: string): Promise<void> => {
      await window.api.memory.acceptSuggestion(suggestionId)
      await loadSuggestions()
    },
    [loadSuggestions]
  )
  const rejectSuggestion = useCallback(
    async (suggestionId: string): Promise<void> => {
      await window.api.memory.rejectSuggestion(suggestionId)
      await loadSuggestions()
    },
    [loadSuggestions]
  )

  return { acceptSuggestion, rejectSuggestion, suggestions }
}
