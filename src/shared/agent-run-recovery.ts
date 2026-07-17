export const AGENT_RUN_RECOVERY_SCHEMA_VERSION = 1

export interface AgentRunRecoveryRequired {
  action: "app_restart_required"
  reason: "terminal_persistence_failed"
  schemaVersion: typeof AGENT_RUN_RECOVERY_SCHEMA_VERSION
}

export function createAgentRunRecoveryRequired(): AgentRunRecoveryRequired {
  return {
    action: "app_restart_required",
    reason: "terminal_persistence_failed",
    schemaVersion: AGENT_RUN_RECOVERY_SCHEMA_VERSION
  }
}

export function parseAgentRunRecoveryRequired(value: unknown): AgentRunRecoveryRequired | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3
  ) {
    return null
  }
  const candidate = value as Record<string, unknown>
  return candidate.action === "app_restart_required" &&
    candidate.reason === "terminal_persistence_failed" &&
    candidate.schemaVersion === AGENT_RUN_RECOVERY_SCHEMA_VERSION
    ? createAgentRunRecoveryRequired()
    : null
}
