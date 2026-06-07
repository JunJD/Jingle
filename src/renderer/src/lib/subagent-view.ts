import type { Subagent, Thread } from "@/types"

export type WorkBoardStatus = "pending" | "in_progress" | "interrupted" | "done"

export interface SubagentCounts {
  completed: number
  failed: number
  pending: number
  running: number
  total: number
}

export interface SubagentReferenceView {
  detail: string
  key: string
  status: Subagent["status"]
  subagentType: string | null
  title: string
}

export interface SubagentStatusLabels {
  completed: string
  failed: string
  pending: string
  running: string
}

export interface SubagentStatusPresentation {
  badge: "critical" | "info" | "nominal" | "outline"
  className: string
  label: string
}

export function countSubagents(subagents: readonly Subagent[]): SubagentCounts {
  const counts: SubagentCounts = {
    completed: 0,
    failed: 0,
    pending: 0,
    running: 0,
    total: subagents.length
  }

  for (const subagent of subagents) {
    counts[subagent.status] += 1
  }

  return counts
}

export function getSubagentDurationLabel(subagent: Subagent): string | null {
  if (!subagent.startedAt || !subagent.completedAt) {
    return null
  }

  const start = new Date(subagent.startedAt).getTime()
  const end = new Date(subagent.completedAt).getTime()
  const durationMs = end - start

  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`
  }

  return `${(durationMs / 60000).toFixed(1)}m`
}

export function getSubagentKanbanStatus(status: Subagent["status"]): WorkBoardStatus {
  switch (status) {
    case "pending":
      return "pending"
    case "running":
      return "in_progress"
    case "completed":
    case "failed":
      return "done"
  }
}

export function getThreadKanbanStatus(input: {
  hasActiveRun: boolean
  hasPendingApproval: boolean
  threadStatus: Thread["status"]
}): WorkBoardStatus {
  if (input.hasPendingApproval || input.threadStatus === "interrupted") {
    return "interrupted"
  }

  if (input.threadStatus === "busy" || input.hasActiveRun) {
    return "in_progress"
  }

  return "done"
}

export function getSubagentStatusLabel(
  status: Subagent["status"],
  labels: SubagentStatusLabels
): string {
  return labels[status === "failed" ? "failed" : status]
}

export function getSubagentStatusPresentation(
  status: Subagent["status"]
): SubagentStatusPresentation {
  switch (status) {
    case "pending":
      return {
        badge: "outline",
        className: "bg-muted text-muted-foreground",
        label: "PENDING"
      }
    case "running":
      return {
        badge: "info",
        className: "bg-status-info/20 text-status-info",
        label: "RUNNING"
      }
    case "completed":
      return {
        badge: "nominal",
        className: "bg-status-nominal/20 text-status-nominal",
        label: "DONE"
      }
    case "failed":
      return {
        badge: "critical",
        className: "bg-status-critical/20 text-status-critical",
        label: "FAILED"
      }
  }
}

export function getSubagentTypeBadge(subagentType?: string): string {
  switch (subagentType) {
    case "correctness-checker":
      return "CHECKER"
    case "final-reviewer":
      return "REVIEWER"
    case "research":
      return "RESEARCH"
    case "general-purpose":
      return "GENERAL"
    default:
      return subagentType?.toUpperCase() || "TASK"
  }
}

export function projectSubagentReferences(subagents: readonly Subagent[]): SubagentReferenceView[] {
  return subagents.map((subagent) => ({
    detail: subagent.description,
    key: subagent.id,
    status: subagent.status,
    subagentType: subagent.subagentType ?? null,
    title: subagent.name
  }))
}
