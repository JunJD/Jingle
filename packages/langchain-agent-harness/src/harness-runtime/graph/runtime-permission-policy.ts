import type {
  RuntimeNodeContext,
  RuntimePermissionDecision
} from "./nodes/runtime/node-contract"
import type {
  RuntimePermissionGateInput,
  RuntimePermissionPolicy
} from "./nodes/runtime/PermissionGateNode"
import type { RuntimeApprovalControllerContract } from "../../runtime-contract"

export interface RuntimePermissionPolicyInput {
  readonly approvalController: RuntimeApprovalControllerContract
  readonly mode: "legacy-human-approval-middleware-handoff"
}

export function createRuntimePermissionPolicy(
  input: RuntimePermissionPolicyInput
): RuntimePermissionPolicy {
  const { approvalController: _approvalController } = input

  return {
    decide(
      _input: RuntimePermissionGateInput,
      _context: RuntimeNodeContext
    ): RuntimePermissionDecision {
      // Real allow / deny / require_approval semantics still run in human-approval-middleware
      // so LangGraph interrupt/resume checkpoints keep their existing shape during migration.
      return {
        owner: "legacy-human-approval-middleware",
        route: "continue",
        toolExecution: "continue"
      }
    }
  }
}
