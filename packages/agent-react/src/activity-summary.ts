export type JingleAgentActivitySummaryCategory =
  | "command"
  | "file"
  | "file_mutation"
  | "list"
  | "search"
  | "web_search"

export type JingleAgentToolExecutionViewStatus =
  | "approval"
  | "arguments_streaming"
  | "complete"
  | "failed"
  | "running"
  | "waiting_result"

export interface JingleAgentActivityToolCallSource {
  args?: Record<string, unknown> | null
  id?: string
  name: string
}

export interface JingleAgentActivitySummaryToolInput {
  status: JingleAgentToolExecutionViewStatus
  toolCall: JingleAgentActivityToolCallSource
}

export interface JingleAgentActivitySummaryProjection {
  activeCategory: JingleAgentActivitySummaryCategory | null
  counts: Partial<Record<JingleAgentActivitySummaryCategory, number>>
  status: "complete" | "running"
}

const JINGLE_AGENT_ACTIVITY_SUMMARY_CATEGORIES: readonly JingleAgentActivitySummaryCategory[] = [
  "file_mutation",
  "file",
  "list",
  "search",
  "web_search",
  "command"
]

function getStringArg(args: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = args[name]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function getToolCallSummaryCategory(
  toolCall: JingleAgentActivityToolCallSource
): JingleAgentActivitySummaryCategory | null {
  switch (toolCall.name) {
    case "execute":
      return "command"
    case "edit_file":
    case "write_file":
      return "file_mutation"
    case "read_file":
      return "file"
    case "ls":
      return "list"
    case "glob":
    case "grep":
    case "get_message_context":
    case "get_trace_evidence":
    case "search_history":
      return "search"
    case "web_search":
      return "web_search"
    default:
      return null
  }
}

function getToolCallSummaryFactKey(
  category: JingleAgentActivitySummaryCategory,
  toolCall: JingleAgentActivityToolCallSource
): string | null {
  const args = toolCall.args ?? {}

  switch (category) {
    case "command":
      return getStringArg(args, ["command"])
    case "file":
      return getStringArg(args, ["path", "file_path"])
    case "file_mutation":
      return getStringArg(args, ["path", "file_path"])
    case "list":
      return getStringArg(args, ["path"])
    case "search":
      return getStringArg(args, [
        "pattern",
        "query",
        "glob",
        "messageId",
        "traceStepId",
        "toolCallId",
        "artifactId",
        "runId"
      ])
    case "web_search":
      return getStringArg(args, ["query", "pattern"])
  }
}

function isPendingToolExecutionStatus(status: JingleAgentToolExecutionViewStatus): boolean {
  return status !== "complete" && status !== "failed"
}

function isCompletedToolExecutionStatus(status: JingleAgentToolExecutionViewStatus): boolean {
  return status === "complete"
}

export function projectJingleAgentActivitySummary(
  tools: readonly JingleAgentActivitySummaryToolInput[]
): JingleAgentActivitySummaryProjection | null {
  if (
    tools.length === 0 ||
    tools.some((tool) => tool.status === "approval" || tool.status === "failed")
  ) {
    return null
  }

  const categorizedTools = tools.map((tool) => ({
    ...tool,
    category: getToolCallSummaryCategory(tool.toolCall)
  }))
  if (categorizedTools.some((tool) => tool.category === null)) {
    return null
  }

  const factKeysByCategory = new Map<JingleAgentActivitySummaryCategory, Set<string>>()
  for (const category of JINGLE_AGENT_ACTIVITY_SUMMARY_CATEGORIES) {
    factKeysByCategory.set(category, new Set())
  }

  for (const tool of categorizedTools.filter((tool) =>
    isCompletedToolExecutionStatus(tool.status)
  )) {
    const category = tool.category!
    const factKey = getToolCallSummaryFactKey(category, tool.toolCall)
    if (!factKey) {
      return null
    }

    factKeysByCategory.get(category)!.add(factKey)
  }

  const counts: Partial<Record<JingleAgentActivitySummaryCategory, number>> = {}
  for (const category of JINGLE_AGENT_ACTIVITY_SUMMARY_CATEGORIES) {
    const count = factKeysByCategory.get(category)?.size ?? 0
    if (count > 0) {
      counts[category] = count
    }
  }

  const latestPendingTool = [...categorizedTools]
    .reverse()
    .find((tool) => isPendingToolExecutionStatus(tool.status))

  return {
    activeCategory: latestPendingTool?.category ?? null,
    counts,
    status: latestPendingTool ? "running" : "complete"
  }
}
