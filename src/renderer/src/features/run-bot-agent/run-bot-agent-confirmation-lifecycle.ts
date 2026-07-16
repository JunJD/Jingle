export interface RunBotAgentConfirmationRequest<TValue> {
  readonly promise: Promise<TValue>
  readonly signal: AbortSignal
}

interface InternalRequest<TValue> extends RunBotAgentConfirmationRequest<TValue> {
  readonly onAbort: () => void
  readonly reject: (error: Error) => void
  readonly resolve: (value: TValue) => void
  removeAbortListener: () => void
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The RunBot Agent request was cancelled.", "AbortError")
}

export class RunBotAgentConfirmationLifecycle<TValue> {
  #current: InternalRequest<TValue> | null = null

  begin(input: {
    concurrentError: string
    onAbort: () => void
    signal: AbortSignal
  }): RunBotAgentConfirmationRequest<TValue> {
    if (this.#current) {
      throw new Error(input.concurrentError)
    }
    input.signal.throwIfAborted()

    let resolvePromise!: (value: TValue) => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<TValue>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const request: InternalRequest<TValue> = {
      onAbort: input.onAbort,
      promise,
      reject: rejectPromise,
      removeAbortListener: () => undefined,
      resolve: resolvePromise,
      signal: input.signal
    }
    const handleAbort = (): void => {
      if (this.#current !== request) {
        return
      }
      this.#current = null
      request.removeAbortListener()
      request.onAbort()
      request.reject(abortError(request.signal))
    }
    request.removeAbortListener = () => input.signal.removeEventListener("abort", handleAbort)
    input.signal.addEventListener("abort", handleAbort, { once: true })
    this.#current = request
    return request
  }

  isCurrent(request: RunBotAgentConfirmationRequest<TValue>): boolean {
    return this.#current === request
  }

  cancelCurrent(error: Error): boolean {
    const request = this.#current
    if (!request) {
      return false
    }
    this.#current = null
    request.removeAbortListener()
    request.reject(error)
    return true
  }

  resolve(request: RunBotAgentConfirmationRequest<TValue>, value: TValue): boolean {
    if (this.#current !== request) {
      return false
    }
    request.signal.throwIfAborted()
    this.#current = null
    const internalRequest = request as InternalRequest<TValue>
    internalRequest.removeAbortListener()
    internalRequest.resolve(value)
    return true
  }

  dispose(error: Error): void {
    void this.cancelCurrent(error)
  }
}
