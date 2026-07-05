import type { RuntimeStoreBoundaryId } from "./runtime-store"

export type RuntimeChildWorkCapability =
  | "task"
  | "subAgent"

export type RuntimeChildWorkImplementationStatus =
  | "state-skeleton"
  | "parent-owned-child-thread"

export interface RuntimeChildWorkStoreRelation {
  childCheckpoint: RuntimeStoreBoundaryId
  parentTaskFact: RuntimeStoreBoundaryId
  productLifecycle: RuntimeStoreBoundaryId
  projection: RuntimeStoreBoundaryId
}

export type RuntimeChildWorkLifecycleStep =
  | "declare-parent-task"
  | "create-child-thread"
  | "run-child-operation"
  | "commit-child-result"
  | "project-parent-summary"

export interface RuntimeChildWorkLifecycleStepContract {
  factStore: RuntimeStoreBoundaryId
  step: RuntimeChildWorkLifecycleStep
  status: "current-skeleton" | "target"
}

export type RuntimeChildWorkEdge =
  | "parent-task-fact"
  | "child-checkpoint"
  | "product-lifecycle"
  | "projection-summary"

export interface RuntimeChildWorkEdgeContract {
  edge: RuntimeChildWorkEdge
  owner: "RuntimeThread" | "child RuntimeThread" | "app-product" | "app-projection"
  store: RuntimeStoreBoundaryId
}

export interface RuntimeChildWorkBoundaryContract {
  capabilities: readonly RuntimeChildWorkCapability[]
  edges: Record<RuntimeChildWorkEdge, RuntimeChildWorkEdgeContract>
  lifecycle: readonly RuntimeChildWorkLifecycleStepContract[]
  parentOwner: "RuntimeThread"
  runnableChild: "not-implemented"
  stateRole: "child-work-skeleton"
  status: RuntimeChildWorkImplementationStatus
  storeRelation: RuntimeChildWorkStoreRelation
  targetModel: "parent-owned-child-thread"
}

export const RUNTIME_CHILD_WORK_BOUNDARY = {
  capabilities: ["task", "subAgent"],
  edges: {
    "child-checkpoint": {
      edge: "child-checkpoint",
      owner: "child RuntimeThread",
      store: "checkpoint"
    },
    "parent-task-fact": {
      edge: "parent-task-fact",
      owner: "RuntimeThread",
      store: "checkpoint"
    },
    "product-lifecycle": {
      edge: "product-lifecycle",
      owner: "app-product",
      store: "productDb"
    },
    "projection-summary": {
      edge: "projection-summary",
      owner: "app-projection",
      store: "projection"
    }
  },
  lifecycle: [
    {
      factStore: "checkpoint",
      status: "current-skeleton",
      step: "declare-parent-task"
    },
    {
      factStore: "checkpoint",
      status: "target",
      step: "create-child-thread"
    },
    {
      factStore: "checkpoint",
      status: "target",
      step: "run-child-operation"
    },
    {
      factStore: "productDb",
      status: "target",
      step: "commit-child-result"
    },
    {
      factStore: "projection",
      status: "target",
      step: "project-parent-summary"
    }
  ],
  parentOwner: "RuntimeThread",
  runnableChild: "not-implemented",
  stateRole: "child-work-skeleton",
  status: "state-skeleton",
  storeRelation: {
    childCheckpoint: "checkpoint",
    parentTaskFact: "checkpoint",
    productLifecycle: "productDb",
    projection: "projection"
  },
  targetModel: "parent-owned-child-thread"
} as const satisfies RuntimeChildWorkBoundaryContract
