export type RuntimeStoreBoundaryId =
  | "checkpoint"
  | "productDb"
  | "projection"

export type RuntimeStoreBoundaryKind =
  | "langgraph-checkpoint"
  | "product-db"
  | "projection"

export type RuntimeStoreOwner = "LangGraph" | "app-product" | "app-projection"

export type RuntimeStoreSemantics =
  | "recoverable-runtime-state"
  | "durable-product-facts"
  | "derived-view"

export interface RuntimeStoreBoundaryContract {
  kind: RuntimeStoreBoundaryKind
  owner: RuntimeStoreOwner
  runtimePackageOwnsBoundary: boolean
  semantics: RuntimeStoreSemantics
}

export const RUNTIME_STORE_BOUNDARY_CONTRACTS = {
  checkpoint: {
    kind: "langgraph-checkpoint",
    owner: "LangGraph",
    runtimePackageOwnsBoundary: true,
    semantics: "recoverable-runtime-state"
  },
  productDb: {
    kind: "product-db",
    owner: "app-product",
    runtimePackageOwnsBoundary: false,
    semantics: "durable-product-facts"
  },
  projection: {
    kind: "projection",
    owner: "app-projection",
    runtimePackageOwnsBoundary: false,
    semantics: "derived-view"
  }
} as const satisfies Record<RuntimeStoreBoundaryId, RuntimeStoreBoundaryContract>
