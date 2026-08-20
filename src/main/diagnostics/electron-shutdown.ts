import type { NormalizedElectronChildProcessDetails } from "./electron-child-process-identity"

/**
 * A child-process-gone event is expected only after main-owned shutdown has
 * started and only for Electron's utility/GPU children. Keep the reason gate
 * narrow; crash and abnormal-exit records remain errors even when an exit
 * code happens to match a normal shutdown signal.
 */
export function isExpectedElectronShutdown(
  shutdownStarted: boolean,
  details: Pick<NormalizedElectronChildProcessDetails, "exitCode" | "processType" | "reason">
): boolean {
  return (
    shutdownStarted &&
    (details.processType === "utility" || details.processType === "gpu") &&
    (details.reason === "clean-exit" || details.reason === "killed")
  )
}
