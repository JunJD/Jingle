import type { RuntimeCheckpointState } from "../../../../runtime-state"
import type { RuntimeNodeContext, RuntimeNodeResult, RuntimeTargetNode } from "./node-contract"

export interface RuntimeContextActivationInput {
  readonly contextInclusions?: RuntimeCheckpointState["contextInclusions"]
}

export interface RuntimeContextActivation {
  readonly contextInclusions: RuntimeCheckpointState["contextInclusions"]
}

export interface RuntimeContextActivator {
  activate(
    input: RuntimeContextActivationInput,
    context: RuntimeNodeContext
  ): Promise<RuntimeContextActivation> | RuntimeContextActivation
}

export type ContextActivationNodeResult = RuntimeNodeResult<
  Pick<RuntimeCheckpointState, "contextInclusions">,
  { activatedContext: RuntimeContextActivation }
>

export class ContextActivationNode
  implements RuntimeTargetNode<RuntimeContextActivationInput, ContextActivationNodeResult>
{
  readonly boundary = "context"
  readonly kind = "ContextActivationNode"

  constructor(private readonly activator: RuntimeContextActivator) {}

  async invoke(
    input: RuntimeContextActivationInput,
    context: RuntimeNodeContext
  ): Promise<ContextActivationNodeResult> {
    const activatedContext = await this.activator.activate(input, context)

    return {
      privateState: {
        activatedContext
      },
      stateUpdate: {
        contextInclusions: activatedContext.contextInclusions
      }
    }
  }
}
