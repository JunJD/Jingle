import { RuntimeModelExecutionKernel } from "./RuntimeModelExecutionKernel.js"

export interface RuntimeModelExecutor {
  invoke(state: unknown, config: unknown): Promise<unknown> | unknown
}

export type RuntimeModelExecutorInput = ConstructorParameters<typeof RuntimeModelExecutionKernel>[0]

export function createRuntimeModelExecutor(input: RuntimeModelExecutorInput): RuntimeModelExecutor {
  const kernel = new RuntimeModelExecutionKernel(input)

  return {
    invoke: (state, config) => kernel.invoke(state, config)
  }
}
