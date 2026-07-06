import type { JingleLangChainTraceEvent } from "./langchain-trace-callback"
import type { JingleAgentRunTraceConfig } from "./run-config"
import type { RuntimeRunContextScope } from "./runtime-scope"

export interface RuntimeObservationBoundaryContract {
  canRouteGraph: false
  canWriteRuntimeState: false
  deferred: readonly RuntimeObservationDeferredSurface[]
  failureSemantics: "record-and-continue"
  implemented: readonly RuntimeObservationImplementedSurface[]
  owns: readonly RuntimeObservationSurface[]
  surfaces: Record<RuntimeObservationSurface, RuntimeObservationSurfaceContract>
}

export type RuntimeObservationDeferredSurface =
  | "diagnostics"
  | "projection-event"
  | "recording"

export type RuntimeObservationImplementedSurface = "trace"

export type RuntimeObservationSurface =
  | "trace"
  | "recording"
  | "diagnostics"
  | "projection-event"

export type RuntimeObservationSurfaceOwner =
  | "RuntimeObservation"
  | "app-observation"
  | "app-projection"

export type RuntimeObservationSurfaceStatus =
  | "implemented"
  | "deferred"

export interface RuntimeObservationSurfaceContract {
  bodyStore: "productDb" | "projection" | "none"
  canRouteGraph: false
  canWriteRuntimeState: false
  owner: RuntimeObservationSurfaceOwner
  recordsRuntimeStateRefs: boolean
  status: RuntimeObservationSurfaceStatus
}

export const RUNTIME_OBSERVATION_BOUNDARY = {
  canRouteGraph: false,
  canWriteRuntimeState: false,
  deferred: ["recording", "diagnostics", "projection-event"],
  failureSemantics: "record-and-continue",
  implemented: ["trace"],
  owns: ["trace", "recording", "diagnostics", "projection-event"],
  surfaces: {
    diagnostics: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-observation",
      recordsRuntimeStateRefs: false,
      status: "deferred"
    },
    "projection-event": {
      bodyStore: "projection",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-projection",
      recordsRuntimeStateRefs: false,
      status: "deferred"
    },
    recording: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "app-observation",
      recordsRuntimeStateRefs: true,
      status: "deferred"
    },
    trace: {
      bodyStore: "productDb",
      canRouteGraph: false,
      canWriteRuntimeState: false,
      owner: "RuntimeObservation",
      recordsRuntimeStateRefs: false,
      status: "implemented"
    }
  }
} as const satisfies RuntimeObservationBoundaryContract

export interface RuntimeTraceRecordInput extends RuntimeRunContextScope {
  event: JingleLangChainTraceEvent
}

export interface RuntimeTraceConfigInput extends RuntimeRunContextScope {
  modelId?: string
}

export interface RuntimeRunTraceConfigInput extends RuntimeTraceConfigInput {
  source: "invoke" | "resume"
}

export interface RuntimeTraceSinkContract {
  createRunConfig?: (input: RuntimeRunTraceConfigInput) => JingleAgentRunTraceConfig
  createRuntimeConfig?: (input: RuntimeTraceConfigInput) => JingleAgentRunTraceConfig
  recordEvent(input: RuntimeTraceRecordInput): Promise<void>
  skippedRunNames?: ReadonlySet<string>
}

export interface RuntimeObservationSinkContract {
  trace?: RuntimeTraceSinkContract
}

export interface RuntimeObservationCapabilities {
  trace?: RuntimeTraceSinkContract
}

export type RuntimeObservationSink = RuntimeObservationSinkContract
export type RuntimeTraceSink = RuntimeTraceSinkContract

export function createRuntimeObservationSink(
  input: RuntimeObservationCapabilities | undefined
): RuntimeObservationSinkContract | undefined {
  return input?.trace ? { trace: input.trace } : undefined
}
