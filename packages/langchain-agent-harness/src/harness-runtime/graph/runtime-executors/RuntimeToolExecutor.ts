import { RuntimeToolExecutionKernel } from "./RuntimeToolExecutionKernel.js"

export interface RuntimeToolExecutor {
  invoke(state: unknown, config: unknown): Promise<unknown> | unknown
}

export type RuntimeToolExecutorTools = ConstructorParameters<typeof RuntimeToolExecutionKernel>[0]
export type RuntimeToolExecutorOptions = ConstructorParameters<typeof RuntimeToolExecutionKernel>[1]

export function createRuntimeToolExecutor(
  tools: RuntimeToolExecutorTools,
  options?: RuntimeToolExecutorOptions
): RuntimeToolExecutor {
  const kernel = new RuntimeToolExecutionKernel(tools, options)

  return {
    invoke: (state, config) => kernel.invoke(state, config)
  }
}
