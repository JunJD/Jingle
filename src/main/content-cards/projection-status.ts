export const ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES = [
  "success",
  "error",
  "cancelled"
] as const

export function isAssistantContentProjectionTerminalRunStatus(status: string | null): boolean {
  return ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES.some(
    (terminalStatus) => terminalStatus === status
  )
}
