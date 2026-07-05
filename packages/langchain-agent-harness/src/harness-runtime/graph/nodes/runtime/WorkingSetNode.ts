import type {
  RuntimeNodeContext,
  RuntimeNodeResult,
  RuntimeTargetNode,
  RuntimeWorkingSet
} from "./node-contract"

export interface RuntimeWorkingSetInput {
  readonly maxMessages?: number
}

export interface RuntimeWorkingSetBuilder {
  build(
    input: RuntimeWorkingSetInput,
    context: RuntimeNodeContext
  ): Promise<RuntimeWorkingSet> | RuntimeWorkingSet
}

export type WorkingSetNodeResult = RuntimeNodeResult<
  Record<string, never>,
  { workingSet: RuntimeWorkingSet }
>

export class WorkingSetNode implements RuntimeTargetNode<
  RuntimeWorkingSetInput,
  WorkingSetNodeResult
> {
  readonly boundary = "working-set"
  readonly kind = "WorkingSetNode"

  constructor(private readonly builder: RuntimeWorkingSetBuilder) {}

  async invoke(
    input: RuntimeWorkingSetInput,
    context: RuntimeNodeContext
  ): Promise<WorkingSetNodeResult> {
    return {
      privateState: {
        workingSet: await this.builder.build(input, context)
      }
    }
  }
}
