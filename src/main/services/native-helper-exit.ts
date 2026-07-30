interface NativeHelperExitHandlerOptions {
  isCurrent: () => boolean
  onCurrentExit: () => void
  onUnexpectedExit: (exitCode: number | null, signal: NodeJS.Signals | null) => void
}

interface NativeHelperExitEmitter {
  on(
    event: "exit",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
}

export function attachNativeHelperExitHandler(
  child: NativeHelperExitEmitter,
  options: NativeHelperExitHandlerOptions
): void {
  child.on("exit", (exitCode, signal) => {
    if (!options.isCurrent()) {
      return
    }
    try {
      options.onUnexpectedExit(exitCode, signal)
    } catch {
      console.error("[native-helper] Failed to observe unexpected process exit.")
    } finally {
      options.onCurrentExit()
    }
  })
}
