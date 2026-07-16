import type { IpcErrorCode } from "./ipc-error"

export const AGENT_RUN_FAILURE_METADATA_KEY = "agentRunFailure"
export const AGENT_RUN_FAILURE_SCHEMA_VERSION = 1

export type AgentRunFailureKind =
  | "authentication"
  | "context_window_exceeded"
  | "rate_limited"
  | "transport_interrupted"
  | "unknown"

export interface AgentRunFailure {
  schemaVersion: typeof AGENT_RUN_FAILURE_SCHEMA_VERSION
  kind: AgentRunFailureKind
  ipcCode: IpcErrorCode
  message: string
  status: number
  details?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAgentRunFailureKind(value: unknown): value is AgentRunFailureKind {
  return (
    value === "authentication" ||
    value === "context_window_exceeded" ||
    value === "rate_limited" ||
    value === "transport_interrupted" ||
    value === "unknown"
  )
}

function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return (
    value === "CANCELLED" ||
    value === "CONFLICT" ||
    value === "FAILED_PRECONDITION" ||
    value === "INTERNAL" ||
    value === "INVALID_ARGUMENT" ||
    value === "NOT_FOUND" ||
    value === "PERMISSION_DENIED" ||
    value === "UNAUTHENTICATED" ||
    value === "UNAVAILABLE"
  )
}

export function parseAgentRunFailure(value: unknown): AgentRunFailure | null {
  if (!isRecord(value)) {
    return null
  }
  const allowedKeys = new Set(["details", "ipcCode", "kind", "message", "schemaVersion", "status"])
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    value.schemaVersion !== AGENT_RUN_FAILURE_SCHEMA_VERSION ||
    !isAgentRunFailureKind(value.kind) ||
    !isIpcErrorCode(value.ipcCode) ||
    typeof value.message !== "string" ||
    !Number.isInteger(value.status) ||
    (value.status as number) < 100 ||
    (value.status as number) > 599 ||
    (Object.hasOwn(value, "details") &&
      (!Array.isArray(value.details) ||
        !value.details.every((entry): entry is string => typeof entry === "string")))
  ) {
    return null
  }
  const details = value.details as string[] | undefined
  const status = value.status as number
  return {
    schemaVersion: AGENT_RUN_FAILURE_SCHEMA_VERSION,
    kind: value.kind,
    ipcCode: value.ipcCode,
    message: value.message,
    status,
    ...(details ? { details } : {})
  }
}

export function encodeAgentRunFailure(failure: AgentRunFailure): Record<string, unknown> {
  return { ...failure }
}

export function createLegacyAgentRunFailure(message: string): AgentRunFailure {
  return {
    schemaVersion: AGENT_RUN_FAILURE_SCHEMA_VERSION,
    kind: "unknown",
    ipcCode: "INTERNAL",
    message,
    status: 500
  }
}
