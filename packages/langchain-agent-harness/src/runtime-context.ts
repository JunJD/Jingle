export type RuntimeContextSurface =
  | "context-retrieval"
  | "memory"
  | "memory-recording-refs"
  | "workspace-file-context"

export type RuntimeContextNeighborSurface =
  | "guardrail"
  | "system-prompt"
  | "title-generation"

export type RuntimeContextMiddlewareExitPriority =
  | "early"
  | "not-context-owned"

export interface RuntimeContextSurfaceContract {
  currentImplementation: "middleware-compiled" | "owned-by-neighbor-lane"
  exitPriority: RuntimeContextMiddlewareExitPriority
  owner: "RuntimeContext" | "RuntimePrompt" | "RuntimeExecutionPolicy"
  surface: RuntimeContextSurface | RuntimeContextNeighborSurface
}

export const RUNTIME_CONTEXT_SURFACE_CONTRACTS = {
  contextRetrieval: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "context-retrieval"
  },
  memory: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "memory"
  },
  memoryRecordingRefs: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "memory-recording-refs"
  },
  workspaceFileContext: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "workspace-file-context"
  },
  guardrail: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimeExecutionPolicy",
    surface: "guardrail"
  },
  systemPrompt: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimePrompt",
    surface: "system-prompt"
  },
  titleGeneration: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimePrompt",
    surface: "title-generation"
  }
} as const satisfies Record<string, RuntimeContextSurfaceContract>
