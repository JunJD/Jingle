import type { FileInfo, Todo } from "@/types"

export type ToolFileEntry = string | FileInfo

export interface ToolGrepMatch {
  path: string
  line?: number
  text?: string
}

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
  const path = args.path ?? args.file_path
  return typeof path === "string" && path.trim().length > 0 ? path : null
}

export function getCommandArg(args: Record<string, unknown>): string | null {
  return typeof args.command === "string" && args.command.trim().length > 0 ? args.command : null
}

export function getPatternArg(args: Record<string, unknown>): string | null {
  const pattern = args.pattern ?? args.query ?? args.glob
  return typeof pattern === "string" && pattern.trim().length > 0 ? pattern : null
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

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function asFileEntries(value: unknown): ToolFileEntry[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ToolFileEntry =>
          typeof item === "string" ||
          (Boolean(item) &&
            typeof item === "object" &&
            "path" in item &&
            typeof item.path === "string")
      )
    : []
}

export function asGrepMatches(value: unknown): ToolGrepMatch[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ToolGrepMatch =>
          Boolean(item) &&
          typeof item === "object" &&
          "path" in item &&
          typeof item.path === "string" &&
          (!("line" in item) || item.line === undefined || typeof item.line === "number") &&
          (!("text" in item) || item.text === undefined || typeof item.text === "string")
      )
    : []
}

export function asTodos(value: unknown): Todo[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Todo =>
          Boolean(item) &&
          typeof item === "object" &&
          "id" in item &&
          typeof item.id === "string" &&
          "content" in item &&
          typeof item.content === "string" &&
          "status" in item &&
          typeof item.status === "string"
      )
    : []
}
