interface JingleAgentErrorPayload {
  kind:
    | "authentication"
    | "context_window_exceeded"
    | "rate_limited"
    | "transport_interrupted"
    | "unknown"
  message: string
}

interface JingleAgentViewInput {
  localError: string | null
  runtimeStatus: string | null
  threadError: JingleAgentErrorPayload | null
  threadId: string | null
}

interface JingleAgentViewState {
  canStop: boolean
  error: string | null
  isBusy: boolean
}

function formatJingleAgentErrorForView(
  errorPayload: JingleAgentErrorPayload | null
): string | null {
  if (!errorPayload) {
    return null
  }

  if (errorPayload.kind === "context_window_exceeded") {
    return "Context window exceeded. The conversation history is too long. Please start a new thread to continue."
  }
  if (errorPayload.kind === "rate_limited") {
    return "Rate limit exceeded. Please wait a moment before sending another message."
  }
  if (errorPayload.kind === "authentication") {
    return "Authentication failed. Please check your API key in settings."
  }
  return errorPayload.message
}

export function resolveJingleAgentViewState(input: JingleAgentViewInput): JingleAgentViewState {
  const isBusy = input.runtimeStatus === "running"
  const recoveryError =
    input.runtimeStatus === "recovery_required"
      ? "Run state could not be saved. Restart Jingle before continuing."
      : null

  return {
    canStop: Boolean(input.threadId) && isBusy,
    error: recoveryError ?? formatJingleAgentErrorForView(input.threadError) ?? input.localError,
    isBusy
  }
}
