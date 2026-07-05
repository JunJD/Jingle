export type RuntimeShellCapability = "shell"

export type RuntimeShellExecutionSurface = "tool-mediated"

export type RuntimeShellOwner =
  | "RuntimeSandbox"
  | "RuntimeExecutionPolicy"
  | "RuntimeApproval"

export type RuntimeShellImplementationStatus = "deferred-operation-capability"

export interface RuntimeShellBoundaryContract {
  capability: RuntimeShellCapability
  cwdOwner: "RuntimeSandbox"
  executionSurface: RuntimeShellExecutionSurface
  implementationStatus: RuntimeShellImplementationStatus
  operationKind: "not-introduced"
  owners: readonly RuntimeShellOwner[]
  policyOwner: "RuntimeExecutionPolicy"
  userApprovalOwner: "RuntimeApproval"
}

export const RUNTIME_SHELL_BOUNDARY = {
  capability: "shell",
  cwdOwner: "RuntimeSandbox",
  executionSurface: "tool-mediated",
  implementationStatus: "deferred-operation-capability",
  operationKind: "not-introduced",
  owners: ["RuntimeSandbox", "RuntimeExecutionPolicy", "RuntimeApproval"],
  policyOwner: "RuntimeExecutionPolicy",
  userApprovalOwner: "RuntimeApproval"
} as const satisfies RuntimeShellBoundaryContract
