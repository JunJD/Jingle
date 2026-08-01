import { join } from "node:path"
import { app } from "electron"
import { createJingleComputerUseNativeBackend } from "@jingle/computer-use-core"
import type { ComputerUseApplicationService, ComputerUseApplicationServiceOptions } from "./service"
import { createComputerUseApplicationService } from "./service"
import {
  createComputerUseNativeInvocation,
  createComputerUseNativeProcessBridge,
  resolveComputerUseBackendEnvironment
} from "./native-process"
import { resolveNativeBinaryPath } from "../services/native-binary-path"
import { diagnosticsGraph } from "../diagnostics/instance"

export async function createProductionComputerUseApplicationService(input: {
  authorizeTarget: NonNullable<ComputerUseApplicationServiceOptions["authorizeTarget"]>
}): Promise<ComputerUseApplicationService> {
  const environment = resolveComputerUseBackendEnvironment(process.platform, process.env)
  if (!environment) throw new Error("Computer use is unavailable on this platform.")
  const artifactName =
    environment === "macos-quartz"
      ? "jingle-computer-use-macos"
      : environment === "windows-win32"
        ? "jingle-computer-use-windows.ps1"
        : "jingle-computer-use-linux.py"
  const artifactPath = resolveNativeBinaryPath({
    candidates: {
      appPath: join(app.getAppPath(), "out", "native", artifactName),
      compiledPath: join(__dirname, "..", "native", artifactName),
      cwdPath: join(process.cwd(), "out", "native", artifactName)
    },
    isPackaged: app.isPackaged
  })
  if (!artifactPath) throw new Error("Computer-use native helper is not installed.")
  const bridge = createComputerUseNativeProcessBridge({
    environment,
    invocation: createComputerUseNativeInvocation(environment, artifactPath)
  })
  const backend = await createJingleComputerUseNativeBackend(environment, bridge)
  return createComputerUseApplicationService(backend, {
    authorizeTarget: input.authorizeTarget,
    traceSink: {
      record: (event) => {
        diagnosticsGraph.capture({
          component: "computer-use",
          dimensionEntries: [
            { key: "dispatchOccurred", value: String(event.dispatchOccurred) },
            { key: "environment", value: event.environment },
            { key: "errorCode", value: event.errorCode },
            ...(event.exitCode === undefined
              ? []
              : [{ key: "exitCode", value: String(event.exitCode) }]),
            ...(event.nativeCode ? [{ key: "nativeCode", value: event.nativeCode }] : []),
            { key: "operation", value: event.operation },
            { key: "platform", value: event.platform },
            ...(event.processSignal ? [{ key: "processSignal", value: event.processSignal }] : []),
            { key: "transactionId", value: event.transactionId }
          ],
          eventCode: "computer_use.operation_failed",
          fingerprint: `computer_use.operation_failed:${event.operation}:${event.errorCode}`,
          level: "error",
          operation: event.operation,
          recoverable: true,
          refs: [
            { id: event.threadId, kind: "agent-thread" },
            { id: event.runId, kind: "agent-run" }
          ],
          stateImpact: event.dispatchOccurred
            ? "desktop-side-effect-possible-ledger-outcome-unknown"
            : "desktop-action-not-dispatched",
          summary: "Computer Use operation failed; the durable ledger retained dispatch truth."
        })
      }
    }
  })
}
