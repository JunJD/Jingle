import type { BaseMessage } from "@langchain/core/messages"
import type { RuntimeCheckpointState } from "../../../../runtime-state"
import type { RuntimeNodeContext, RuntimeNodeResult, RuntimeTargetNode } from "./node-contract"

export interface RuntimeModelStepInput {
  readonly messages: BaseMessage[]
}

export interface RuntimeModelStepOutput {
  readonly graphOutput?: unknown
  readonly messages?: BaseMessage[]
}

export interface RuntimeModelStepExecutor {
  invoke(
    input: RuntimeModelStepInput,
    context: RuntimeNodeContext
  ): Promise<RuntimeModelStepOutput> | RuntimeModelStepOutput
}

export type ModelStepNodeResult = RuntimeNodeResult<
  Pick<RuntimeCheckpointState, "messages">,
  { modelOutput: RuntimeModelStepOutput }
>

export class ModelStepNode implements RuntimeTargetNode<
  RuntimeModelStepInput,
  ModelStepNodeResult
> {
  readonly boundary = "model"
  readonly kind = "ModelStepNode"

  constructor(private readonly executor: RuntimeModelStepExecutor) {}

  async invoke(
    input: RuntimeModelStepInput,
    context: RuntimeNodeContext
  ): Promise<ModelStepNodeResult> {
    const modelOutput = await this.executor.invoke(input, context)
    let stateUpdate: ModelStepNodeResult["stateUpdate"]
    if (modelOutput.graphOutput === undefined) {
      if (!modelOutput.messages) {
        throw new Error("[ModelStepNode] Model output must include messages.")
      }

      stateUpdate = { messages: modelOutput.messages }
    }

    return {
      privateState: {
        modelOutput
      },
      ...(stateUpdate ? { stateUpdate } : {})
    }
  }
}
