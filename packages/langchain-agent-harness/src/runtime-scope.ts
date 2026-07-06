export interface RuntimeThreadScope {
  threadId: string
  workspacePath: string
}

export interface RuntimeRunContextScope extends RuntimeThreadScope {
  runId: string
}

export interface RuntimeRunCapabilityScope extends RuntimeRunContextScope {
  modelId?: string
}
