import { diffLines } from "diff"
import type { FileMutationFileViewModel } from "./file-mutation-view-model"

export interface FileMutationLineStats {
  additions: number
  deletions: number
}

const lineStatsCache = new WeakMap<FileMutationFileViewModel, FileMutationLineStats>()

export function getFileMutationBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function getCompactFileMutationPath(path: string, workspacePath?: string | null): string {
  if (!workspacePath) {
    return path
  }

  const normalizedWorkspace = workspacePath.replace(/[\\/]+$/, "")
  const prefix = `${normalizedWorkspace}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

function countContentLines(value: string): number {
  if (value.length === 0) {
    return 0
  }

  const normalizedValue = value.endsWith("\n") ? value.slice(0, -1) : value
  return normalizedValue.length === 0 ? 0 : normalizedValue.split("\n").length
}

function countPatchLineStats(patch: string): FileMutationLineStats {
  let additions = 0
  let deletions = 0

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue
    }

    if (line.startsWith("+")) {
      additions += 1
    } else if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

export function getFileMutationLineStats(file: FileMutationFileViewModel): FileMutationLineStats {
  const cachedStats = lineStatsCache.get(file)
  if (cachedStats) {
    return cachedStats
  }

  let stats: FileMutationLineStats

  if (file.patch) {
    stats = countPatchLineStats(file.patch)
  } else if (file.before === null && file.after !== null) {
    stats = {
      additions: countContentLines(file.after),
      deletions: 0
    }
  } else if (file.before !== null && file.after === null) {
    stats = {
      additions: 0,
      deletions: countContentLines(file.before)
    }
  } else if (file.before !== null && file.after !== null) {
    stats = diffLines(file.before, file.after).reduce<FileMutationLineStats>(
      (stats, part) => {
        const lines = countContentLines(part.value)
        return {
          additions: stats.additions + (part.added ? lines : 0),
          deletions: stats.deletions + (part.removed ? lines : 0)
        }
      },
      { additions: 0, deletions: 0 }
    )
  } else {
    stats = { additions: 0, deletions: 0 }
  }

  lineStatsCache.set(file, stats)
  return stats
}

export function formatFileMutationLineStats(file: FileMutationFileViewModel): string | null {
  const stats = getFileMutationLineStats(file)
  const parts = [
    stats.additions > 0 ? `+${stats.additions}` : null,
    stats.deletions > 0 ? `-${stats.deletions}` : null
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" ") : null
}
