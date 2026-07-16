import { getExecuteCommandPolicy, type ExecuteCommandPolicy } from "@shared/execute-command-policy"
import { getMutationPrediction, type MutationPrediction } from "@shared/mutation-prediction"

export function joinSummaryParts(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (typeof part === "number" ? String(part) : part?.trim() || ""))
    .filter(Boolean)
    .join(" · ")
}

export function getBasename(path: string): string {
  return path.split("/").pop() || path
}

export function getPathArg(args: Record<string, unknown>): string | null {
  return typeof args.path === "string" && args.path.trim().length > 0 ? args.path : null
}

export function getExecuteCommandPolicyArg(
  args: Record<string, unknown>
): ExecuteCommandPolicy | null {
  return getExecuteCommandPolicy(args)
}

export function getMutationPredictionArg(args: Record<string, unknown>): MutationPrediction | null {
  return getMutationPrediction(args)
}

export function truncateMiddle(value: string, limit = 72): string {
  if (value.length <= limit) {
    return value
  }

  const start = Math.ceil((limit - 1) / 2)
  const end = Math.floor((limit - 1) / 2)
  return `${value.slice(0, start)}…${value.slice(value.length - end)}`
}

export function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export type RequiredStringArgProjection =
  | {
      kind: "ready"
      value: string
    }
  | {
      kind: "pending"
    }
  | {
      field: string
      kind: "invalid"
    }

export function projectRequiredStringArg(
  args: Record<string, unknown>,
  field: string,
  allowPending = false
): RequiredStringArgProjection {
  const value = args[field]
  if (isNonEmptyString(value)) {
    return { kind: "ready", value }
  }

  return allowPending ? { kind: "pending" } : { field, kind: "invalid" }
}

export type ToolTodoStatus = "completed" | "in_progress" | "pending"

export interface ToolTodoProjection {
  content: string
  key: string
  status: ToolTodoStatus
}

export type ToolTodosProjection =
  | { field: "todos"; kind: "invalid" }
  | { kind: "pending" }
  | { kind: "ready"; todos: ToolTodoProjection[] }

function isToolTodoStatus(value: unknown): value is ToolTodoStatus {
  return value === "completed" || value === "in_progress" || value === "pending"
}

export function projectToolTodos(value: unknown, allowPending = false): ToolTodosProjection {
  if (!Array.isArray(value)) {
    return allowPending ? { kind: "pending" } : { field: "todos", kind: "invalid" }
  }

  const todos: ToolTodoProjection[] = []
  for (const [index, item] of value.entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      !("content" in item) ||
      typeof item.content !== "string" ||
      !("status" in item) ||
      !isToolTodoStatus(item.status)
    ) {
      return allowPending ? { kind: "pending" } : { field: "todos", kind: "invalid" }
    }

    todos.push({
      content: item.content,
      key: `${index}:${item.status}:${item.content}`,
      status: item.status
    })
  }

  return { kind: "ready", todos }
}
