export interface RuntimeRunBotAgentRequestToken {
  readonly requestId: string
  readonly sessionId: string
  readonly signal: AbortSignal
}

interface InternalToken extends RuntimeRunBotAgentRequestToken {
  readonly controller: AbortController
}

function requestKey(sessionId: string, requestId: string): string {
  return `${sessionId}\u0000${requestId}`
}

export class RuntimeRunBotAgentRequestLifecycle {
  readonly #requests = new Map<string, InternalToken>()

  begin(sessionId: string, requestId: string): RuntimeRunBotAgentRequestToken {
    const key = requestKey(sessionId, requestId)
    this.#requests
      .get(key)
      ?.controller.abort(new DOMException("The RunBot Agent request was replaced.", "AbortError"))
    const controller = new AbortController()
    const token: InternalToken = {
      controller,
      requestId,
      sessionId,
      signal: controller.signal
    }
    this.#requests.set(key, token)
    return token
  }

  release(token: RuntimeRunBotAgentRequestToken): void {
    const key = requestKey(token.sessionId, token.requestId)
    if (this.#requests.get(key) === token) {
      this.#requests.delete(key)
    }
  }

  isCurrent(token: RuntimeRunBotAgentRequestToken): boolean {
    return this.#requests.get(requestKey(token.sessionId, token.requestId)) === token
  }

  syncSession(sessionId: string | null, hasError: boolean): void {
    for (const [key, token] of this.#requests) {
      if (hasError || token.sessionId !== sessionId) {
        this.#requests.delete(key)
        token.controller.abort(
          new DOMException("The extension runtime session ended.", "AbortError")
        )
      }
    }
  }

  dispose(): void {
    this.syncSession(null, true)
  }
}
