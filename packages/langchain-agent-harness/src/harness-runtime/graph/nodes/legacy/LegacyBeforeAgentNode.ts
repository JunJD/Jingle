import { getHookFunction } from "../../middleware/utils.js"
import { LegacyMiddlewareNode } from "./LegacyMiddlewareNode.js"
/**
 * Node for executing a single middleware's beforeAgent hook.
 */
class LegacyBeforeAgentNode extends LegacyMiddlewareNode {
  middleware: any
  lc_namespace = ["langchain", "agents", "beforeAgentNodes"]

  constructor(middleware: any, options: any) {
    super(
      {
        name: `LegacyBeforeAgentNode_${middleware.name}`,
        func: async (state, config) => this.invokeMiddleware(state, config)
      },
      options
    )
    this.middleware = middleware
  }

  runHook(state: any, runtime: any) {
    return getHookFunction(this.middleware.beforeAgent)(state, runtime)
  }
}
export { LegacyBeforeAgentNode }
