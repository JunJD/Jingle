import type {
  LauncherSearchCancellation,
  LauncherSearchInvocation,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "@shared/launcher-search"

interface LauncherSearchInvoke {
  <TResult>(channel: string, ...args: unknown[]): Promise<TResult>
}

function createLauncherSearchCancelledError(): Error & { code: "CANCELLED" } {
  const error = new Error("Launcher search was cancelled.") as Error & { code: "CANCELLED" }
  error.name = "CANCELLED"
  error.code = "CANCELLED"
  return error
}

export function createLauncherSearchInvoker(
  invoke: LauncherSearchInvoke
): (
  request: LauncherSearchRequest,
  options?: { signal?: AbortSignal }
) => Promise<LauncherSearchResponse> {
  let nextCallerId = 0

  return (request, options = {}) => {
    const callerId = `renderer-${++nextCallerId}`
    const { signal } = options
    if (signal?.aborted) {
      return Promise.reject(createLauncherSearchCancelledError())
    }

    const invocation: LauncherSearchInvocation = { callerId, request }
    const cancel = (): void => {
      const cancellation: LauncherSearchCancellation = { callerId }
      void invoke<boolean>("launcher:cancelSearch", cancellation).catch(() => undefined)
    }
    signal?.addEventListener("abort", cancel, { once: true })

    return invoke<LauncherSearchResponse>("launcher:search", invocation).finally(() => {
      signal?.removeEventListener("abort", cancel)
    })
  }
}
