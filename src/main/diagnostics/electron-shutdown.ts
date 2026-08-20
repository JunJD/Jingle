import type { NormalizedElectronChildProcessDetails } from "./electron-child-process-identity"

/**
 * A child-process-gone event is expected only after main-owned shutdown has
 * started and only for Electron's utility/GPU children. Keep the reason gate
 * narrow; crash or abnormal-exit records remain errors unless the existing
 * exit-15 shutdown evidence is present.
 */
export function isExpectedElectronShutdown(
  shutdownStarted: boolean,
  details: Pick<NormalizedElectronChildProcessDetails, "exitCode" | "processType" | "reason">
): boolean {
  return (
    shutdownStarted &&
    (details.processType === "utility" || details.processType === "gpu") &&
    (details.reason === "clean-exit" || details.reason === "killed" || details.exitCode === 15)
  )
}
