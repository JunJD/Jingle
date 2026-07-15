import {
  RUNTIME_CHILD_WORK_BOUNDARY,
  RUNTIME_SESSION_BOUNDARY,
  type RuntimeThreadSessionPolicy
} from "./runtime-session"

export type RuntimeWorkbenchName = "Runtime"

export interface RuntimeWorkbenchContract {
  creationAssembly: RuntimeCreationAssemblyContract
  entrypoints: Record<RuntimePackageEntrypointId, RuntimePackageEntrypointContract>
  internalOnly: readonly RuntimeInternalOnlySurface[]
  publicName: RuntimeWorkbenchName
  publicSurface: readonly RuntimePublicSurfaceCapability[]
  publicSurfaceContracts: Record<RuntimePublicSurfaceCapability, RuntimePublicSurfaceContract>
  sessionPolicy: RuntimeThreadSessionPolicy
}

export type RuntimePackageEntrypointId = "root" | "transitional"

export type RuntimePackageEntrypointName = "." | "./transitional"

export type RuntimePackageEntrypointRole = "public-runtime-facade" | "migration-debt"

export interface RuntimePackageEntrypointContract {
  entrypoint: RuntimePackageEntrypointName
  role: RuntimePackageEntrypointRole
  targetApi: boolean
}

export type RuntimePublicSurfaceCapability =
  | "createRuntime"
  | "observation"
  | "operation"
  | "state"
  | "store"
  | "thread"

export type RuntimePublicSurfaceStability = "target" | "transitional"

export type RuntimePublicSurfaceRole =
  | "operation-contract"
  | "public-control-surface"
  | "recoverable-state-contract"
  | "runtime-creation"
  | "store-boundary-contract"
  | "observation-boundary-contract"

export interface RuntimeCreationAssemblyContract {
  acceptedBy: "createRuntime"
  inputFields: readonly ["bindExecution", "control"]
  reason: string
  stability: "target"
  targetApi: true
}

export interface RuntimePublicSurfaceContract {
  capability: RuntimePublicSurfaceCapability
  reason: string
  role: RuntimePublicSurfaceRole
  stability: RuntimePublicSurfaceStability
  targetApi: boolean
}

export type RuntimeInternalOnlySurface =
  | "checkpoint-projection-readers"
  | "graph-engine"
  | "host-contract"
  | "jingle-named-helper-builders"
  | "legacy-middleware-segment"
  | "capability-contribution"
  | "middleware-builders"
  | "runtime-execution-assembly"
  | "runtime-graph-nodes"
  | "transitional-helpers"

export type RuntimePackageSourceFile =
  | "src/index.ts"
  | "src/root-transitional-api.ts"
  | "src/runtime-public-api.ts"

export type RuntimePackageRootExportGroup =
  | RuntimePublicSurfaceCapability
  | "child-work-boundary"
  | "context-boundary"
  | "session-boundary"
  | "shell-boundary"

export interface RuntimePackageRootBoundaryContract {
  entrypoint: "."
  exportGroups: readonly RuntimePackageRootExportGroup[]
  forbiddenInternalSurfaces: readonly RuntimeInternalOnlySurface[]
  implementationFile: "src/runtime-public-api.ts"
  role: "public-runtime-facade"
  sourceFile: "src/index.ts"
  targetApi: true
  targetExportGroups: readonly RuntimePackageRootExportGroup[]
}

export interface RuntimePackageTransitionalBoundaryContract {
  entrypoint: "./transitional"
  exportGroups: readonly RuntimeInternalOnlySurface[]
  retirementCondition: string
  role: "migration-debt"
  sourceFile: "src/root-transitional-api.ts"
  targetApi: false
}

export interface RuntimePackageExportBoundaryContract {
  packageName: "@jingle/langchain-agent-harness"
  root: RuntimePackageRootBoundaryContract
  transitional: RuntimePackageTransitionalBoundaryContract
}

export const RUNTIME_WORKBENCH_CONTRACT = {
  creationAssembly: {
    acceptedBy: "createRuntime",
    inputFields: ["bindExecution", "control"],
    reason:
      "createRuntime owns one runtime instance. Durable admission binds required per-run execution capabilities, while control owns pause and run lifecycle behavior.",
    stability: "target",
    targetApi: true
  },
  entrypoints: {
    root: {
      entrypoint: ".",
      role: "public-runtime-facade",
      targetApi: true
    },
    transitional: {
      entrypoint: "./transitional",
      role: "migration-debt",
      targetApi: false
    }
  },
  internalOnly: [
    "checkpoint-projection-readers",
    "graph-engine",
    "host-contract",
    "jingle-named-helper-builders",
    "legacy-middleware-segment",
    "capability-contribution",
    "middleware-builders",
    "runtime-execution-assembly",
    "runtime-graph-nodes",
    "transitional-helpers"
  ],
  publicName: "Runtime",
  publicSurface: ["createRuntime", "thread", "operation", "state", "store", "observation"],
  publicSurfaceContracts: {
    createRuntime: {
      capability: "createRuntime",
      reason: "Create the runtime workbench. This remains the package root creation function.",
      role: "runtime-creation",
      stability: "target",
      targetApi: true
    },
    observation: {
      capability: "observation",
      reason:
        "Observation is a runtime event surface. It can record trace/diagnostics/projection events, but cannot route graph execution or own RuntimeState.",
      role: "observation-boundary-contract",
      stability: "target",
      targetApi: true
    },
    operation: {
      capability: "operation",
      reason:
        "RuntimeDurableOperation is the auditable invoke/resume state-change input. Drain and terminal requests are internal run controls; compact remains deferred until Pause 4 provides checkpoint CAS.",
      role: "operation-contract",
      stability: "target",
      targetApi: true
    },
    state: {
      capability: "state",
      reason: "RuntimeState is the checkpointed recoverable fact schema consumed by RuntimeGraph.",
      role: "recoverable-state-contract",
      stability: "target",
      targetApi: true
    },
    store: {
      capability: "store",
      reason: "Store contracts separate checkpoint, product DB, and projection ownership.",
      role: "store-boundary-contract",
      stability: "target",
      targetApi: true
    },
    thread: {
      capability: "thread",
      reason:
        "RuntimeThread is the public invoke/resume and run lifecycle control surface. Compact is currently unsupported and deferred to Pause 4.",
      role: "public-control-surface",
      stability: "target",
      targetApi: true
    }
  },
  sessionPolicy: {
    childWorkStatus: RUNTIME_CHILD_WORK_BOUNDARY.status,
    publicSessionType: RUNTIME_SESSION_BOUNDARY.publicSessionType,
    publicThreadType: RUNTIME_SESSION_BOUNDARY.publicThreadType
  }
} as const satisfies RuntimeWorkbenchContract

export const RUNTIME_PACKAGE_EXPORT_BOUNDARY = {
  packageName: "@jingle/langchain-agent-harness",
  root: {
    entrypoint: ".",
    exportGroups: [
      "createRuntime",
      "thread",
      "operation",
      "state",
      "store",
      "observation",
      "context-boundary",
      "session-boundary",
      "child-work-boundary",
      "shell-boundary"
    ],
    forbiddenInternalSurfaces: RUNTIME_WORKBENCH_CONTRACT.internalOnly,
    implementationFile: "src/runtime-public-api.ts",
    role: "public-runtime-facade",
    sourceFile: "src/index.ts",
    targetApi: true,
    targetExportGroups: [
      "createRuntime",
      "thread",
      "operation",
      "state",
      "store",
      "observation",
      "context-boundary",
      "session-boundary",
      "child-work-boundary",
      "shell-boundary"
    ]
  },
  transitional: {
    entrypoint: "./transitional",
    exportGroups: [
      "checkpoint-projection-readers",
      "jingle-named-helper-builders",
      "middleware-builders",
      "transitional-helpers"
    ],
    retirementCondition: "delete when app and tests no longer import the transitional subpath",
    role: "migration-debt",
    sourceFile: "src/root-transitional-api.ts",
    targetApi: false
  }
} as const satisfies RuntimePackageExportBoundaryContract

export { RUNTIME_CHILD_WORK_BOUNDARY, RUNTIME_SESSION_BOUNDARY } from "./runtime-session"
export type { RuntimeThreadSessionPolicy }
