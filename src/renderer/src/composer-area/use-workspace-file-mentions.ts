import { useEffect, useState } from "react"
import type { ComposerWorkspaceFileMention } from "./types"

const EMPTY_WORKSPACE_FILE_MENTIONS: ComposerWorkspaceFileMention[] = []

export function useWorkspaceFileMentions(
  threadId: string | null,
  query: string | null
): ComposerWorkspaceFileMention[] {
  const [searchResult, setSearchResult] = useState<{
    files: ComposerWorkspaceFileMention[]
    key: string
  } | null>(null)
  const normalizedQuery = query?.trim() ?? ""
  const searchKey = threadId && normalizedQuery.length > 0 ? `${threadId}\0${normalizedQuery}` : null

  useEffect(() => {
    if (!threadId || !searchKey) {
      return
    }

    let cancelled = false
    window.api.workspace
      .searchFiles(threadId, normalizedQuery, 8)
      .then((result) => {
        if (cancelled) {
          return
        }

        setSearchResult({
          files: result.success ? (result.files ?? []) : [],
          key: searchKey
        })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        console.warn("[ComposerArea] Workspace file search failed", error)
        setSearchResult({
          files: [],
          key: searchKey
        })
      })

    return () => {
      cancelled = true
    }
  }, [normalizedQuery, searchKey, threadId])

  if (!searchKey || searchResult?.key !== searchKey) {
    return EMPTY_WORKSPACE_FILE_MENTIONS
  }

  return searchResult.files
}
