
import { RunnableCallable } from "../../RunnableCallable.js"
import { derivePrivateState } from "./legacy-node-utils.js"
import { getHookConstraint } from "../../middleware/utils.js"
import { interopParse } from "@langchain/core/utils/types"
/**
 * Named class for context objects to provide better error messages
 */
const AgentContext = class {}
const AgentRuntime = class {}

class LegacyMiddlewareNode extends RunnableCallable {
  middleware: any
  #options: { getState: () => Record<string, unknown> }

  constructor(fields: any, options: { getState: () => Record<string, unknown> }) {
    super(fields)
    this.#options = options
  }

  async invokeMiddleware(invokeState: any, config: any) {
    /**
     * Filter context based on middleware's contextSchema
     */
    let filteredContext: Record<string, unknown> = {}
    /**
     * Parse context using middleware's contextSchema to apply defaults and validation
     */
    if (this.middleware.contextSchema) {
      /**
       * Extract only the fields relevant to this middleware's schema
       */
      const schemaShape = this.middleware.contextSchema?.shape
      if (schemaShape) {
        const relevantContext: Record<string, unknown> = {}
        const invokeContext = config?.context || {}
        for (const key of Object.keys(schemaShape))
          if (key in invokeContext) relevantContext[key] = invokeContext[key]
        /**
         * Parse to apply defaults and validation, even if relevantContext is empty
         * This will throw if required fields are missing and no defaults exist
         */
        filteredContext = interopParse(this.middleware.contextSchema, relevantContext)
      }
    }
    const state = {
      ...this.#options.getState(),
      ...invokeState,
      messages: invokeState.messages
    }
    const runtime = {
      context: filteredContext,
      store: config?.store,
      configurable: config?.configurable,
      writer: config?.writer,
      interrupt: config?.interrupt,
      signal: config?.signal
    }
    const result = await this.runHook(
      state,
      /**
       * assign runtime and context values into empty named class
       * instances to create a better error message.
       */
      Object.freeze(
        Object.assign(new AgentRuntime(), {
          ...runtime,
          context: Object.freeze(Object.assign(new AgentContext(), filteredContext))
        })
      )
    )
    /**
     * If result is undefined, the hook made no state changes — return
     * only the jumpTo sentinel so we don't re-emit every input key as
     * a state update.
     */
    if (!result) return { jumpTo: void 0 }
    const hookResult = result as any
    /**
     * Verify that the jump target is allowed for the middleware
     */
    let jumpToConstraint
    let constraint
    if (this.name?.startsWith("LegacyBeforeAgentNode_")) {
      jumpToConstraint = getHookConstraint(this.middleware.beforeAgent)
      constraint = "beforeAgent.canJumpTo"
    } else if (this.name?.startsWith("LegacyBeforeModelNode_")) {
      jumpToConstraint = getHookConstraint(this.middleware.beforeModel)
      constraint = "beforeModel.canJumpTo"
    } else if (this.name?.startsWith("LegacyAfterAgentNode_")) {
      jumpToConstraint = getHookConstraint(this.middleware.afterAgent)
      constraint = "afterAgent.canJumpTo"
    } else if (this.name?.startsWith("LegacyAfterModelNode_")) {
      jumpToConstraint = getHookConstraint(this.middleware.afterModel)
      constraint = "afterModel.canJumpTo"
    }
    if (typeof hookResult.jumpTo === "string" && !jumpToConstraint?.includes(hookResult.jumpTo)) {
      const suggestion =
        jumpToConstraint && jumpToConstraint.length > 0
          ? `must be one of: ${jumpToConstraint?.join(", ")}.`
          : constraint
            ? `no ${constraint} defined in middleware ${this.middleware.name}`
            : ""
      throw new Error(`Invalid jump target: ${hookResult.jumpTo}, ${suggestion}.`)
    }
    /**
     * If result is a control action, handle it
     */
    if (typeof hookResult === "object" && "type" in hookResult) {
      if (hookResult.type === "terminate") {
        if (hookResult.error) throw hookResult.error
        return {
          ...state,
          ...(hookResult.result || {}),
          jumpTo: hookResult.jumpTo
        }
      }
      throw new Error(`Invalid control action: ${JSON.stringify(hookResult)}`)
    }
    /**
     * If result is a state update, merge it with current state
     */
    return {
      ...state,
      ...hookResult,
      jumpTo: hookResult.jumpTo
    }
  }
  runHook(_state: any, _runtime: any): unknown {
    throw new Error("[LegacyMiddlewareNode] Subclass must implement runHook.")
  }

  get nodeOptions() {
    return { input: derivePrivateState(this.middleware.stateSchema) }
  }
}
export { LegacyMiddlewareNode }
