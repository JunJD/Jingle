import {
  RUNTIME_CHILD_WORK_BOUNDARY,
  type RuntimeChildWorkImplementationStatus
} from "./runtime-child-work"

export type RuntimePublicThreadType = "RuntimeThread"
export type RuntimePublicSessionType = "not-introduced"

export type RuntimeChildWorkStatus = RuntimeChildWorkImplementationStatus

export interface RuntimeThreadSessionPolicy {
  childWorkStatus: RuntimeChildWorkStatus
  publicSessionType: RuntimePublicSessionType
  publicThreadType: RuntimePublicThreadType
}

export interface RuntimeSessionBoundaryContract {
  publicSessionType: RuntimePublicSessionType
  publicThreadType: RuntimePublicThreadType
  sessionNameReservedFor: "future-product-entity"
  threadRole: "public-control-surface"
}

export const RUNTIME_SESSION_BOUNDARY = {
  publicSessionType: "not-introduced",
  publicThreadType: "RuntimeThread",
  sessionNameReservedFor: "future-product-entity",
  threadRole: "public-control-surface"
} as const satisfies RuntimeSessionBoundaryContract

export { RUNTIME_CHILD_WORK_BOUNDARY }
