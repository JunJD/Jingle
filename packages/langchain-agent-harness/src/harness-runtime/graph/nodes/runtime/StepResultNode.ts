import type { RuntimeNodeContext, RuntimeNodeResult, RuntimeStepRoute, RuntimeTargetNode } from "./node-contract"

export interface StepResultInput {
  readonly error?: unknown
  readonly route: RuntimeStepRoute
}

export interface RuntimeStepRouter {
  route(input: StepResultInput, context: RuntimeNodeContext): RuntimeStepRoute
}

export class StepResultNode implements RuntimeTargetNode<StepResultInput, RuntimeNodeResult> {
  readonly boundary = "route"
  readonly kind = "StepResultNode"

  constructor(private readonly router: RuntimeStepRouter) {}

  invoke(input: StepResultInput, context: RuntimeNodeContext): RuntimeNodeResult {
    if (input.route === "error" && input.error) throw input.error

    return {
      route: this.router.route(input, context)
    }
  }
}
