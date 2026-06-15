import type { AppCopy } from "@/lib/i18n/messages"
import {
  projectAgentActivitySummary,
  type AgentActivitySummaryCategory,
  type AgentActivitySummaryProjection,
  type AgentActivitySummaryToolInput,
  type AgentToolExecutionViewStatus
} from "@/lib/message-projection"

export type AgentActivitySummaryIcon = "command" | "file" | "folder" | "pencil" | "search"

export interface AgentActivitySummaryTool extends AgentActivitySummaryToolInput {
  status: AgentToolExecutionViewStatus
}

export interface AgentActivityHeaderSummary {
  detail: string | null
  icon: AgentActivitySummaryIcon
  title: string
}

function joinSummaryDetail(parts: Array<string | null>): string | null {
  const detail = parts.filter(Boolean).join(" · ")
  return detail.length > 0 ? detail : null
}

function hasCategory(
  counts: AgentActivitySummaryProjection["counts"],
  category: AgentActivitySummaryCategory
): boolean {
  return counts[category] !== undefined
}

function getCategoryIcon(category: AgentActivitySummaryCategory): AgentActivitySummaryIcon {
  switch (category) {
    case "command":
      return "command"
    case "file":
      return "file"
    case "file_mutation":
      return "pencil"
    case "list":
      return "folder"
    case "search":
    case "web_search":
      return "search"
  }
}

function getRunningTitle(copy: AppCopy, category: AgentActivitySummaryCategory): string {
  switch (category) {
    case "command":
      return copy.chat.toolActivityRunningCommand
    case "file":
      return copy.chat.toolActivityRunningRead
    case "file_mutation":
      return copy.chat.toolActivityRunningFileMutation
    case "list":
      return copy.chat.toolActivityRunningList
    case "search":
      return copy.chat.toolActivityRunningSearch
    case "web_search":
      return copy.chat.toolActivityRunningWebSearch
  }
}

function getCountDetail(
  copy: AppCopy,
  category: AgentActivitySummaryCategory,
  count: number
): string {
  switch (category) {
    case "command":
      return copy.chat.toolActivityCommands(count)
    case "file":
      return copy.chat.toolActivityFiles(count)
    case "file_mutation":
      return copy.chat.toolActivityFileMutations(count)
    case "list":
      return copy.chat.toolActivityLists(count)
    case "search":
      return copy.chat.toolActivitySearches(count)
    case "web_search":
      return copy.chat.toolActivityWebSearches(count)
  }
}

function hasOnlyCategory(
  counts: AgentActivitySummaryProjection["counts"],
  category: AgentActivitySummaryCategory
): boolean {
  return (
    hasCategory(counts, category) &&
    Object.entries(counts).every(([key, value]) => key === category || value === undefined)
  )
}

export function projectAgentActivityHeaderSummary(
  copy: AppCopy,
  tools: readonly AgentActivitySummaryTool[]
): AgentActivityHeaderSummary | null {
  const projection = projectAgentActivitySummary(tools)
  if (!projection) {
    return null
  }

  const detail = joinSummaryDetail([
    projection.counts.file ? getCountDetail(copy, "file", projection.counts.file) : null,
    projection.counts.file_mutation
      ? getCountDetail(copy, "file_mutation", projection.counts.file_mutation)
      : null,
    projection.counts.search ? getCountDetail(copy, "search", projection.counts.search) : null,
    projection.counts.list ? getCountDetail(copy, "list", projection.counts.list) : null,
    projection.counts.web_search
      ? getCountDetail(copy, "web_search", projection.counts.web_search)
      : null,
    projection.counts.command ? getCountDetail(copy, "command", projection.counts.command) : null
  ])

  if (projection.status === "running" && projection.activeCategory) {
    return {
      detail,
      icon: getCategoryIcon(projection.activeCategory),
      title: getRunningTitle(copy, projection.activeCategory)
    }
  }

  const primaryCategory =
    hasCategory(projection.counts, "file")
      ? "file"
      : hasCategory(projection.counts, "file_mutation")
        ? "file_mutation"
        : hasCategory(projection.counts, "search")
          ? "search"
          : hasCategory(projection.counts, "list")
            ? "list"
            : hasCategory(projection.counts, "web_search")
              ? "web_search"
              : hasCategory(projection.counts, "command")
                ? "command"
                : null

  return {
    detail,
    icon: primaryCategory ? getCategoryIcon(primaryCategory) : "search",
    title: hasOnlyCategory(projection.counts, "command")
      ? copy.chat.toolActivityRanCommands
      : hasOnlyCategory(projection.counts, "file_mutation")
        ? copy.chat.toolActivityChangedFiles
      : hasOnlyCategory(projection.counts, "web_search")
        ? copy.chat.toolActivitySearchedWeb
        : hasCategory(projection.counts, "command")
          ? copy.chat.toolActivityCompleted
          : copy.chat.toolActivityExplored
  }
}
