
import { Runnable, mergeConfigs } from "@langchain/core/runnables"
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons"
interface RunnableCallableFields {
  func: (input: any, config: any) => any
  name?: string
  recurse?: boolean
  tags?: string[]
}

class RunnableCallable extends Runnable<any, any> {
  lc_namespace = ["langgraph"]
  func: RunnableCallableFields["func"]
  tags?: string[]
  config?: any
  trace = true
  recurse = true
  #state: any

  constructor(fields: RunnableCallableFields) {
    super()
    this.name = fields.name ?? fields.func.name
    this.func = fields.func
    this.tags = fields.tags
    this.config = fields.tags ? { tags: fields.tags } : undefined
    this.recurse = fields.recurse ?? this.recurse
  }

  getState(): any {
    return this.#state
  }

  /**
   * This allows us to set the state of the runnable, e.g. for model and middleware nodes.
   * @internal
   */
  setState(state: any): void {
    this.#state = {
      ...this.#state,
      ...state
    }
  }

  async invoke(input: any, options?: any): Promise<any> {
    const mergedConfig = mergeConfigs(this.config, options)
    const returnValue = await AsyncLocalStorageProviderSingleton.runWithConfig(mergedConfig, async () =>
      this.func(input, mergedConfig)
    )
    if (Runnable.isRunnable(returnValue) && this.recurse)
      return await AsyncLocalStorageProviderSingleton.runWithConfig(mergedConfig, async () =>
        returnValue.invoke(input, mergedConfig)
      )
    this.#state = returnValue
    return returnValue
  }
}
export { RunnableCallable }
