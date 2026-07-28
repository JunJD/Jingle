import type { EventEmitter } from "node:events"

interface NativeHelperStdinErrorHandlerOptions {
  isCurrent: () => boolean
  onUnexpectedError: (error: unknown) => void
}

export function attachNativeHelperStdinErrorHandler(
  stdin: Pick<EventEmitter, "on"> | null,
  options: NativeHelperStdinErrorHandlerOptions
): void {
  let observedUnexpectedError = false
  stdin?.on("error", (error: unknown) => {
    if (!options.isCurrent() || observedUnexpectedError) {
      return
    }
    observedUnexpectedError = true
    try {
      options.onUnexpectedError(error)
    } catch {
      console.error("[native-helper] Failed to observe stdin transport failure.")
    }
  })
}
