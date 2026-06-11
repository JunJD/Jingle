import { useEffect, useState } from "react"
import type { ComposerWorkspaceFileMention } from "./types"

const EMPTY_WORKSPACE_FILE_MENTIONS: ComposerWorkspaceFileMention[] = []

export interface WorkspaceFileMentionSearchState {
  files: ComposerWorkspaceFileMention[]
  isIncomplete: boolean
  isSearching: boolean
  searchEnabled: boolean
}

export function useWorkspaceFileMentions(
  threadId: string | null,
  query: string | null
): WorkspaceFileMentionSearchState {
  const [searchResult, setSearchResult] = useState<{
    files: ComposerWorkspaceFileMention[]
    isIncomplete: boolean
    key: string
    searchEnabled: boolean
  } | null>(null)
  const normalizedQuery = query?.trim() ?? ""
  const searchKey =
    normalizedQuery.length > 0 ? `${threadId ?? "__global__"}\0${normalizedQuery}` : null

  useEffect(() => {
    if (!searchKey) {
      return
    }

    let cancelled = false
    window.api.workspace
      .searchFiles(threadId ?? undefined, normalizedQuery, 8)
      .then((result) => {
        if (cancelled) {
          return
        }

        setSearchResult({
          files: result.success ? (result.files ?? []) : [],
          isIncomplete: result.success ? result.incomplete === true : false,
          key: searchKey,
          searchEnabled: result.success || result.error !== "No workspace folder linked"
        })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        console.warn("[ComposerArea] Workspace file search failed", error)
        setSearchResult({
          files: [],
          isIncomplete: false,
          key: searchKey,
          searchEnabled: true
        })
      })

    return () => {
      cancelled = true
    }
  }, [normalizedQuery, searchKey, threadId])

  if (!searchKey) {
    return {
      files: EMPTY_WORKSPACE_FILE_MENTIONS,
      isIncomplete: false,
      isSearching: false,
      searchEnabled: true
    }
  }

  if (searchResult?.key !== searchKey) {
    return {
      files: EMPTY_WORKSPACE_FILE_MENTIONS,
      isIncomplete: false,
      isSearching: true,
      searchEnabled: true
    }
  }

  return {
    files: searchResult.files,
    isIncomplete: searchResult.isIncomplete,
    isSearching: false,
    searchEnabled: searchResult.searchEnabled
  }
}
