import { FolderOpen } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolFileList } from "./shared-components"
import {
  asFileEntries,
  asStringArray,
  getBasename,
  getPathArg,
  getPatternArg,
  type ToolFileEntry
} from "./shared"

const DIRECTORY_RESULT_SUFFIX = " (directory)"

function countDirectoryEntries(items: ToolFileEntry[]): { dirs: number; files: number } {
  const dirs = items.filter((item) => typeof item === "object" && item.is_dir).length
  return { dirs, files: items.length - dirs }
}

function asDirectoryEntries(result: unknown): ToolFileEntry[] {
  const entries = asFileEntries(result)

  if (entries.length > 0 || typeof result !== "string") {
    return entries
  }

  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
    .map((line) =>
      line.endsWith(DIRECTORY_RESULT_SUFFIX)
        ? { path: line.slice(0, -DIRECTORY_RESULT_SUFFIX.length), is_dir: true }
        : line
    )
}

defineToolComponent({
  name: "ls",
  icon: FolderOpen,
  hasDetail({ args, result }) {
    return Boolean(getPathArg(args) || asDirectoryEntries(result).length > 0)
  },
  renderDisplay({ copy, args, result }) {
    const path = getPathArg(args)
    const target = path ? getBasename(path) : null
    const entries = asDirectoryEntries(result)
    const counts = countDirectoryEntries(entries)
    const countsLabel =
      entries.length > 0 ? copy.toolCall.filesAndFolders(counts.files, counts.dirs) : null

    return {
      detail: target ?? countsLabel,
      resultMeta: target ? countsLabel : null,
      title: copy.toolCall.labels.ls
    }
  },
  renderDetail({ args, result }) {
    const path = getPathArg(args)
    const entries = asDirectoryEntries(result)

    if (!path && entries.length === 0) {
      return null
    }

    return (
      <ToolDetailStack>
        {path ? (
          <ToolCodeBlock className="text-[var(--ow-agent-timeline-muted)]">{path}</ToolCodeBlock>
        ) : null}
        <ToolFileList items={entries} />
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "glob",
  icon: FolderOpen,
  hasDetail({ args, result }) {
    return Boolean(getPatternArg(args) || asStringArray(result).length > 0)
  },
  renderDisplay({ copy, args, result }) {
    const pattern = getPatternArg(args)
    const matches = asStringArray(result)

    return {
      detail: pattern,
      resultMeta: matches.length > 0 ? copy.toolCall.foundMatches(matches.length) : null,
      title: copy.toolCall.labels.glob
    }
  },
  renderDetail({ args, result }) {
    const pattern = getPatternArg(args)
    const matches = asStringArray(result)

    if (!pattern && matches.length === 0) {
      return null
    }

    return (
      <ToolDetailStack>
        {pattern ? (
          <ToolCodeBlock className="text-[var(--ow-agent-timeline-muted)]">{pattern}</ToolCodeBlock>
        ) : null}
        <ToolFileList items={matches} />
      </ToolDetailStack>
    )
  }
})
