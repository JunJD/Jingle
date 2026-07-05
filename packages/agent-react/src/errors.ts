interface JingleAgentErrorPayload {
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

  const errorMessage = errorPayload.message
  const contextWindowMatch = errorMessage.match(/prompt is too long: (\d+) tokens > (\d+) maximum/i)
  if (contextWindowMatch) {
    const [, usedTokens, maxTokens] = contextWindowMatch
    const usedK = Math.round(parseInt(usedTokens, 10) / 1000)
    const maxK = Math.round(parseInt(maxTokens, 10) / 1000)
    return `Context window exceeded (${usedK}K / ${maxK}K tokens). The conversation history is too long. Please start a new thread to continue.`
  }

  if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
    return "Rate limit exceeded. Please wait a moment before sending another message."
  }

  if (
    errorMessage.includes("401") ||
    errorMessage.includes("invalid_api_key") ||
    errorMessage.includes("authentication")
  ) {
    return "Authentication failed. Please check your API key in settings."
  }

  return errorMessage
}

export function resolveJingleAgentViewState(input: JingleAgentViewInput): JingleAgentViewState {
  const isBusy = input.runtimeStatus === "running"

  return {
    canStop: Boolean(input.threadId) && isBusy,
    error: formatJingleAgentErrorForView(input.threadError) ?? input.localError,
    isBusy
  }
}
