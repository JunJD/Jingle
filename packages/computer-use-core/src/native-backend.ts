import { computerUseCapabilityMatrix } from "./capabilities"
import type {
  ComputerUseBackend,
  ComputerUseBackendExecutionResult,
  ComputerUseBackendEnvironment,
  ComputerUseBackendObservation,
  ComputerUseExecuteRequest,
  ComputerUseObserveRequest
} from "./contract"

export type JingleComputerUseNativeRequest =
  | { method: "observe"; request: ComputerUseObserveRequest }
  | { method: "execute"; request: ComputerUseExecuteRequest }
  | { method: "dispose_session"; sessionId: string }

export interface JingleComputerUseNativeBridge {
  invoke<T>(request: JingleComputerUseNativeRequest, signal?: AbortSignal): Promise<T>
}

export class JingleComputerUseNativeBackend implements ComputerUseBackend {
  readonly matrix

  constructor(
    readonly environment: ComputerUseBackendEnvironment,
    private readonly bridge: JingleComputerUseNativeBridge
  ) {
    this.matrix = computerUseCapabilityMatrix(environment)
  }

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation> {
    request.signal?.throwIfAborted()
    const result = await this.bridge.invoke<ComputerUseBackendObservation>(
      { method: "observe", request },
      request.signal
    )
    this.assertObservation(result)
    return result
  }

  async execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult> {
    request.signal?.throwIfAborted()
    for (const action of request.actions) {
      const capability = this.matrix.capabilities.find((candidate) => candidate.action === action.kind)
      const support = capability?.[request.delivery]
      if (!capability || support === "unavailable" || support === "refused") {
        return {
          baseStateId: request.base.stateId,
          outcome: support === "refused" ? "refused" : "unavailable",
          steps: [
            {
              action,
              evidence: {
                delivery: "semantic",
                noSideEffectProof: true,
                route: capability?.route ?? "unavailable",
                verification: "failed"
              },
              outcome: support === "refused" ? "refused" : "unavailable"
            }
          ],
          stoppedAt: 0
        }
      }
    }
    return this.bridge.invoke<ComputerUseBackendExecutionResult>(
      { method: "execute", request },
      request.signal
    )
  }

  async disposeSession(sessionId: string): Promise<void> {
    await this.bridge.invoke<void>({ method: "dispose_session", sessionId })
  }

  private assertObservation(observation: ComputerUseBackendObservation): void {
    if (observation.window.platform !== this.matrix.platform) {
      throw new Error(
        `Computer-use backend ${this.environment} returned ${observation.window.platform} observation.`
      )
    }
    if (!observation.resourceKey || !observation.window.generation) {
      throw new Error("Computer-use backend returned an incomplete immutable observation.")
    }
  }
}
