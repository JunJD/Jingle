export const MUTATION_PREDICTION_ARG = "__openwork_mutation_prediction" as const

export type MutationPredictionStatus =
  | "predicted"
  | "command_failed"
  | "unsupported_command"
  | "simulation_error"
  | "timed_out"
  | "unsupported_platform"

export type MutationPredictionConfidence = "none" | "low" | "medium"

export type MutationChangeType = "create" | "modify" | "delete"

export interface MutationPredictionChange {
  path: string
  changeType: MutationChangeType
}

export interface MutationPrediction {
  command: string
  status: MutationPredictionStatus
  confidence: MutationPredictionConfidence
  summary: string
  changes: MutationPredictionChange[]
  durationMs: number
  exitCode: number | null
  stderr: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMutationChangeType(value: unknown): value is MutationChangeType {
  return value === "create" || value === "modify" || value === "delete"
}

function isMutationPredictionStatus(value: unknown): value is MutationPredictionStatus {
  return (
    value === "predicted" ||
    value === "command_failed" ||
    value === "unsupported_command" ||
    value === "simulation_error" ||
    value === "timed_out" ||
    value === "unsupported_platform"
  )
}

function isMutationPredictionConfidence(value: unknown): value is MutationPredictionConfidence {
  return value === "none" || value === "low" || value === "medium"
}

export function withMutationPrediction(
  args: Record<string, unknown>,
  prediction: MutationPrediction
): Record<string, unknown> {
  return {
    ...args,
    [MUTATION_PREDICTION_ARG]: prediction
  }
}

export function getMutationPrediction(args: Record<string, unknown>): MutationPrediction | null {
  const value = args[MUTATION_PREDICTION_ARG]
  if (!isRecord(value)) {
    return null
  }

  const command = typeof value.command === "string" ? value.command : null
  const status = isMutationPredictionStatus(value.status) ? value.status : null
  const confidence = isMutationPredictionConfidence(value.confidence) ? value.confidence : null
  const summary = typeof value.summary === "string" ? value.summary : null
  const durationMs = typeof value.durationMs === "number" ? value.durationMs : null
  const exitCode =
    typeof value.exitCode === "number" || value.exitCode === null ? value.exitCode : null
  const stderr = typeof value.stderr === "string" || value.stderr === null ? value.stderr : null
  const rawChanges = Array.isArray(value.changes) ? value.changes : null

  if (
    command === null ||
    status === null ||
    confidence === null ||
    summary === null ||
    durationMs === null ||
    rawChanges === null
  ) {
    return null
  }

  const changes = rawChanges.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !isMutationChangeType(entry.changeType)
    ) {
      return []
    }

    return [
      {
        path: entry.path,
        changeType: entry.changeType
      }
    ]
  })

  return {
    command,
    status,
    confidence,
    summary,
    changes,
    durationMs,
    exitCode,
    stderr
  }
}
