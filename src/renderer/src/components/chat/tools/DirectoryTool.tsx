import { FolderOpen } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolFileList } from "./shared-components"
import {
  asFileEntries,
  asStringArray,
  getBasename,
  getPathArg,
  getPatternArg,
  joinSummaryParts,
  type ToolFileEntry
} from "./shared"

function countDirectoryEntries(items: ToolFileEntry[]): { dirs: number; files: number } {
  const dirs = items.filter((item) => typeof item === "object" && item.is_dir).length
  return { dirs, files: items.length - dirs }
}

defineToolComponent({
  name: "ls",
  icon: FolderOpen,
  renderSummary({ copy, args, result, status }) {
    const path = getPathArg(args)
    const target = path ? getBasename(path) : copy.toolCall.labels.ls
    const entries = asFileEntries(result)
    const counts = countDirectoryEntries(entries)

    return joinSummaryParts(
      copy.toolCall.labels.ls,
      target,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : status === "error"
            ? copy.common.error
            : entries.length > 0
              ? copy.toolCall.filesAndFolders(counts.files, counts.dirs)
              : copy.common.completed
    )
  },
  renderDetail({ args, result }) {
    const path = getPathArg(args)
    const entries = asFileEntries(result)

    if (!path && entries.length === 0) {
      return null
    }

    return (
      <ToolDetailStack>
        {path ? <ToolCodeBlock>{path}</ToolCodeBlock> : null}
        <ToolFileList items={entries} />
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "glob",
  icon: FolderOpen,
  renderSummary({ copy, args, result, status }) {
    const pattern = getPatternArg(args)
    const matches = asStringArray(result)

    return joinSummaryParts(
      copy.toolCall.labels.glob,
      pattern,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : status === "error"
            ? copy.common.error
            : matches.length > 0
              ? copy.toolCall.foundMatches(matches.length)
              : copy.common.completed
    )
  },
  renderDetail({ args, result }) {
    const pattern = getPatternArg(args)
    const matches = asStringArray(result)

    if (!pattern && matches.length === 0) {
      return null
    }

    return (
      <ToolDetailStack>
        {pattern ? <ToolCodeBlock>{pattern}</ToolCodeBlock> : null}
        <ToolFileList items={matches} />
      </ToolDetailStack>
    )
  }
})
