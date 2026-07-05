import { getHookFunction } from "../../middleware/utils.js"
import { LegacyMiddlewareNode } from "./LegacyMiddlewareNode.js"
/**
 * Node for executing a single middleware's afterAgent hook.
 */
class LegacyAfterAgentNode extends LegacyMiddlewareNode {
  middleware: any
  lc_namespace = ["langchain", "agents", "afterAgentNodes"]

  constructor(middleware: any, options: any) {
    super(
      {
        name: `LegacyAfterAgentNode_${middleware.name}`,
        func: async (state, config) => this.invokeMiddleware(state, config)
      },
      options
    )
    this.middleware = middleware
  }

  runHook(state: any, runtime: any) {
    return getHookFunction(this.middleware.afterAgent)(state, runtime)
  }
}
export { LegacyAfterAgentNode }
