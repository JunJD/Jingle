import type { RuntimeCheckpointState } from "../../../../runtime-state"
import type { RuntimeNodeContext, RuntimeNodeResult, RuntimeTargetNode } from "./node-contract"

export interface RuntimeToolStepInput {
  readonly toolCalls: readonly unknown[]
}

export type ToolStepUpdate = Partial<
  Pick<RuntimeCheckpointState, "approvals" | "artifacts" | "messages" | "recordingRefs" | "todos">
> & {
  readonly graphOutput?: unknown
}

export interface RuntimeToolStepExecutor {
  execute(input: RuntimeToolStepInput, context: RuntimeNodeContext): Promise<ToolStepUpdate> | ToolStepUpdate
}

export type ToolStepNodeResult = RuntimeNodeResult<ToolStepUpdate, { toolUpdate: ToolStepUpdate }>

export class ToolStepNode implements RuntimeTargetNode<RuntimeToolStepInput, ToolStepNodeResult> {
  readonly boundary = "tool"
  readonly kind = "ToolStepNode"

  constructor(private readonly executor: RuntimeToolStepExecutor) {}

  async invoke(input: RuntimeToolStepInput, context: RuntimeNodeContext): Promise<ToolStepNodeResult> {
    const toolUpdate = await this.executor.execute(input, context)
    const stateUpdate =
      toolUpdate.graphOutput === undefined
        ? toolUpdate
        : undefined

    return {
      privateState: {
        toolUpdate
      },
      ...(stateUpdate ? { stateUpdate } : {})
    }
  }
}
