export interface SerializedProcessError {
  message: string
  name?: string
  stack?: string
}

export function serializeProcessError(error: unknown): SerializedProcessError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  }

  return {
    message: String(error)
  }
}

export function errorFromUnhandledRejection(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }

  return new Error(`Unhandled promise rejection: ${String(reason)}`)
}

export function formatFatalMainProcessError(error: unknown, logFilePath: string): string {
  const serialized = serializeProcessError(error)
  return [
    serialized.message || "Openwork encountered an unrecoverable main process error.",
    "",
    `Diagnostics were written to: ${logFilePath}`,
    "",
    "Openwork will quit now. Please restart the app."
  ].join("\n")
}
