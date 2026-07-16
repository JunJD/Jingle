import type { BaseMessage } from "@langchain/core/messages"
import type { RuntimeTitleGeneratorContract } from "../../../../runtime-contract"
import type { RuntimeProjectionFailureObserver } from "../../../../runtime-observation"
import type { RuntimeCheckpointState } from "../../../../runtime-state"
import { shouldGenerateJingleTitle } from "../../../../title-policy"
import type { RuntimeNodeResult, RuntimeTargetNode } from "./node-contract"

export interface RuntimeTitleProjectionInput {
  messages: BaseMessage[]
  title?: string | null
}

export type TitleProjectionNodeResult = RuntimeNodeResult<
  Partial<Pick<RuntimeCheckpointState, "title">>
>

export class TitleProjectionNode implements RuntimeTargetNode<
  RuntimeTitleProjectionInput,
  TitleProjectionNodeResult
> {
  readonly boundary = "projection"
  readonly kind = "TitleProjectionNode"

  constructor(
    private readonly generateTitle: RuntimeTitleGeneratorContract,
    private readonly observeFailure?: RuntimeProjectionFailureObserver
  ) {}

  async invoke(input: RuntimeTitleProjectionInput): Promise<TitleProjectionNodeResult> {
    if (!shouldGenerateJingleTitle(input)) {
      return {}
    }

    try {
      const title = await this.generateTitle(input)
      return title ? { stateUpdate: { title } } : {}
    } catch (error) {
      this.#observeFailure(error)
      return {}
    }
  }

  #observeFailure(error: unknown): void {
    try {
      this.observeFailure?.({ error, projection: "title" })
    } catch {
      // Observation cannot change the projection or core run outcome.
    }
  }
}
