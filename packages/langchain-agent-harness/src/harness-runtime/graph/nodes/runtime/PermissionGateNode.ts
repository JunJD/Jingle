import type { RuntimeCheckpointState } from "../../../../runtime-state"
import type {
  RuntimeNodeContext,
  RuntimeNodeResult,
  RuntimePermissionDecision,
  RuntimeTargetNode
} from "./node-contract"

export interface RuntimePermissionGateInput {
  readonly toolCalls: readonly unknown[]
}

export interface RuntimePermissionPolicy {
  decide(
    input: RuntimePermissionGateInput,
    context: RuntimeNodeContext
  ): Promise<RuntimePermissionDecision> | RuntimePermissionDecision
}

export type PermissionGateNodeResult = RuntimeNodeResult<
  Partial<Pick<RuntimeCheckpointState, "approvals" | "messages">>,
  { permissionDecision: RuntimePermissionDecision }
>

export class PermissionGateNode
  implements RuntimeTargetNode<RuntimePermissionGateInput, PermissionGateNodeResult>
{
  readonly boundary = "permission"
  readonly kind = "PermissionGateNode"

  constructor(private readonly policy: RuntimePermissionPolicy) {}

  async invoke(
    input: RuntimePermissionGateInput,
    context: RuntimeNodeContext
  ): Promise<PermissionGateNodeResult> {
    const permissionDecision = await this.policy.decide(input, context)
    if (
      permissionDecision.toolExecution === "skip" &&
      (!permissionDecision.messages || permissionDecision.messages.length === 0)
    ) {
      throw new Error(
        "[RuntimeGraph] PermissionGateNode skip decisions must provide tool-result messages."
      )
    }
    const stateUpdate: PermissionGateNodeResult["stateUpdate"] = {
      ...(permissionDecision.approvals ? { approvals: permissionDecision.approvals } : {}),
      ...(permissionDecision.messages ? { messages: permissionDecision.messages } : {})
    }

    return {
      privateState: {
        permissionDecision
      },
      route: permissionDecision.route,
      stateUpdate
    }
  }
}
