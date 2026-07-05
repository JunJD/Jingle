import { getHookFunction } from "../../middleware/utils.js"
import { LegacyMiddlewareNode } from "./LegacyMiddlewareNode.js"
/**
 * Node for executing a single middleware's afterModel hook.
 */
class LegacyAfterModelNode extends LegacyMiddlewareNode {
  middleware: any
  lc_namespace = ["langchain", "agents", "afterModelNodes"]

  constructor(middleware: any, options: any) {
    super(
      {
        name: `LegacyAfterModelNode_${middleware.name}`,
        func: async (state, config) => this.invokeMiddleware(state, config)
      },
      options
    )
    this.middleware = middleware
  }
  runHook(state: any, runtime: any) {
    return getHookFunction(this.middleware.afterModel)(state, runtime)
  }
}
export { LegacyAfterModelNode }
