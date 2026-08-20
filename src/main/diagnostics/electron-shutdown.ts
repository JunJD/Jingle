import type { NormalizedElectronChildProcessDetails } from "./electron-child-process-identity"

/**
 * A child-process-gone event is expected only after main-owned shutdown has
 * started and only for Electron's utility/GPU children. Keep the reason gate
 * narrow; crash, OOM, and integrity-failure records remain errors. Electron
 * versions that report a SIGTERM-style shutdown as abnormal-exit are accepted
 * only with the exact exit code 15.
 */
export function isExpectedElectronShutdown(
  shutdownStarted: boolean,
  details: Pick<NormalizedElectronChildProcessDetails, "exitCode" | "processType" | "reason">
): boolean {
  return (
    shutdownStarted &&
    (details.processType === "utility" || details.processType === "gpu") &&
    details.reason === "clean-exit" ||
    details.reason === "killed" ||
    (details.reason === "abnormal-exit" && details.exitCode === 15)
  )
}
