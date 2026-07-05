import {
  createRuntimeOperationFrame,
  type RuntimeNodeContext,
  type RuntimeNodeResult,
  type RuntimeOperationFrame,
  type RuntimeTargetNode
} from "./node-contract"

export type OperationFrameNodeResult = RuntimeNodeResult<
  Record<string, never>,
  { frame: RuntimeOperationFrame }
>

export class OperationFrameNode implements RuntimeTargetNode<undefined, OperationFrameNodeResult> {
  readonly boundary = "operation"
  readonly kind = "OperationFrameNode"

  invoke(_input: undefined, context: RuntimeNodeContext): OperationFrameNodeResult {
    return {
      privateState: {
        frame: createRuntimeOperationFrame(context.operation)
      }
    }
  }
}
