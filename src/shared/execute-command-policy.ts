export const EXECUTE_COMMAND_POLICY_ARG = "__jingle_execute_command_policy" as const

export type ExecuteCommandProfile =
  | "read_only"
  | "network_read"
  | "predictable_mutation"
  | "managed_process"
  | "unknown_command"
  | "host_unsafe"

export type ExecuteCommandDisposition = "allow" | "require_approval" | "deny"

export interface ExecuteCommandPolicy {
  command: string
  profile: ExecuteCommandProfile
  disposition: ExecuteCommandDisposition
  summary: string
  reason: string
  commands: string[]
  networkTargets?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isExecuteCommandProfile(value: unknown): value is ExecuteCommandProfile {
  return (
    value === "read_only" ||
    value === "network_read" ||
    value === "predictable_mutation" ||
    value === "managed_process" ||
    value === "unknown_command" ||
    value === "host_unsafe"
  )
}

function isExecuteCommandDisposition(value: unknown): value is ExecuteCommandDisposition {
  return value === "allow" || value === "require_approval" || value === "deny"
}

export function withExecuteCommandPolicy(
  args: Record<string, unknown>,
  policy: ExecuteCommandPolicy
): Record<string, unknown> {
  return {
    ...args,
    [EXECUTE_COMMAND_POLICY_ARG]: policy
  }
}

export function getExecuteCommandPolicy(
  args: Record<string, unknown>
): ExecuteCommandPolicy | null {
  const value = args[EXECUTE_COMMAND_POLICY_ARG]
  if (!isRecord(value)) {
    return null
  }

  const command = typeof value.command === "string" ? value.command : null
  const profile = isExecuteCommandProfile(value.profile) ? value.profile : null
  const disposition = isExecuteCommandDisposition(value.disposition) ? value.disposition : null
  const summary = typeof value.summary === "string" ? value.summary : null
  const reason = typeof value.reason === "string" ? value.reason : null
  const commands = Array.isArray(value.commands)
    ? value.commands.filter((entry): entry is string => typeof entry === "string")
    : null
  const networkTargets = Array.isArray(value.networkTargets)
    ? value.networkTargets.filter((entry): entry is string => typeof entry === "string")
    : undefined

  if (
    command === null ||
    profile === null ||
    disposition === null ||
    summary === null ||
    reason === null ||
    commands === null
  ) {
    return null
  }

  return {
    command,
    profile,
    disposition,
    summary,
    reason,
    commands,
    ...(networkTargets ? { networkTargets } : {})
  }
}
