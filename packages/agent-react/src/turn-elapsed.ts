export interface JingleTurnElapsedExecutionSource {
  completedAt?: Date | null
  durationMs?: number | null
  startedAt?: Date | null
  status?: string
}

export interface JingleTurnElapsedToolResultSource {
  execution?: JingleTurnElapsedExecutionSource | null
}

export interface JingleTurnElapsedToolResultsSource {
  values: () => Iterable<JingleTurnElapsedToolResultSource>
}

export type JingleTurnElapsedProjection =
  | {
      completedAt: null
      durationMs: null
      startedAt: Date
      status: "working"
    }
  | {
      completedAt: Date
      durationMs: number
      startedAt: Date
      status: "worked"
    }

function toFiniteTimestamp(value: Date | null | undefined): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function getCompletedExecutionRange(
  execution: JingleTurnElapsedExecutionSource | null | undefined
): { completedAtMs: number; startedAtMs: number } | null {
  if (!execution || (execution.status !== "completed" && execution.status !== "failed")) {
    return null
  }

  const startedAtMs = toFiniteTimestamp(execution.startedAt)
  if (startedAtMs === null) {
    return null
  }

  const completedAtMs =
    toFiniteTimestamp(execution.completedAt) ??
    (typeof execution.durationMs === "number" && Number.isFinite(execution.durationMs)
      ? startedAtMs + execution.durationMs
      : null)

  if (completedAtMs === null) {
    return null
  }

  return {
    completedAtMs,
    startedAtMs
  }
}

export function projectJingleTurnElapsedDivider(input: {
  activeRunStartedAt?: Date | null
  isStreaming: boolean
  toolResults: JingleTurnElapsedToolResultsSource
}): JingleTurnElapsedProjection | null {
  if (input.isStreaming) {
    return input.activeRunStartedAt
      ? {
          completedAt: null,
          durationMs: null,
          startedAt: input.activeRunStartedAt,
          status: "working"
        }
      : null
  }

  let startedAtMs: number | null = null
  let completedAtMs: number | null = null

  for (const result of input.toolResults.values()) {
    const range = getCompletedExecutionRange(result.execution)
    if (!range) {
      continue
    }

    startedAtMs =
      startedAtMs === null ? range.startedAtMs : Math.min(startedAtMs, range.startedAtMs)
    completedAtMs =
      completedAtMs === null ? range.completedAtMs : Math.max(completedAtMs, range.completedAtMs)
  }

  if (startedAtMs === null || completedAtMs === null) {
    return null
  }

  return {
    completedAt: new Date(completedAtMs),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    startedAt: new Date(startedAtMs),
    status: "worked"
  }
}
