import { useCachedPromise, useLocalStorage } from "@openwork/extension-utils"
import { resolveAllFiles } from "./api"
import { STARRED_CONFIG, VISITED_CONFIG } from "./lib/fileStorage"
import type { FigmaFile } from "./types"

function dedupeFiles(files: FigmaFile[], maxItems: number): FigmaFile[] {
  const seen = new Set<string>()
  const nextFiles: FigmaFile[] = []

  for (const file of files) {
    if (seen.has(file.key)) {
      continue
    }
    seen.add(file.key)
    nextFiles.push(file)
    if (nextFiles.length >= maxItems) {
      break
    }
  }

  return nextFiles
}

function useFileCollection(storageKey: string, maxItems: number) {
  const { isLoading, removeValue, setValue, value } = useLocalStorage<FigmaFile[]>(storageKey, [])
  const files = value ?? []

  return {
    clear: removeValue,
    files,
    isLoading,
    async removeFile(file: FigmaFile) {
      await setValue((current = []) => current.filter((item) => item.key !== file.key))
    },
    async saveFile(file: FigmaFile) {
      await setValue((current = []) => dedupeFiles([file, ...current], maxItems))
    }
  }
}

export function useFigmaData(execute: boolean) {
  const allFilesState = useCachedPromise(resolveAllFiles, [], {
    execute,
    keepPreviousData: true
  })
  const starredState = useFileCollection(STARRED_CONFIG.storageKey, STARRED_CONFIG.maxItems)
  const visitedState = useFileCollection(VISITED_CONFIG.storageKey, VISITED_CONFIG.maxItems)

  return {
    allFiles: allFilesState.data ?? [],
    error: allFilesState.error,
    isLoading: allFilesState.isLoading || starredState.isLoading || visitedState.isLoading,
    revalidateAllFiles: allFilesState.revalidate,
    starredFiles: starredState.files,
    starredLimit: STARRED_CONFIG.maxItems,
    starredLoading: starredState.isLoading,
    toggleStar: async (file: FigmaFile) => {
      if (starredState.files.some((item) => item.key === file.key)) {
        await starredState.removeFile(file)
        return
      }
      await starredState.saveFile(file)
    },
    visitFile: visitedState.saveFile,
    visitedFiles: visitedState.files,
    clearVisitedFiles: visitedState.clear
  }
}
