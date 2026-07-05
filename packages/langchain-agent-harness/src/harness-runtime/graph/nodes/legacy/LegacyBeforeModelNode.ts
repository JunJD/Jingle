import { getHookFunction } from "../../middleware/utils.js"
import { LegacyMiddlewareNode } from "./LegacyMiddlewareNode.js"
/**
* Node for executing a single middleware's beforeModel hook.
*/
class LegacyBeforeModelNode extends LegacyMiddlewareNode {
  middleware: any
  lc_namespace = ["langchain", "agents", "beforeModelNodes"]

  constructor(middleware: any, options: any) {
    super(
      {
        name: `LegacyBeforeModelNode_${middleware.name}`,
        func: async (state: any, config: any) => this.invokeMiddleware(state, config)
      },
      options
    )
    this.middleware = middleware
  }

  runHook(state: any, runtime: any) {
    return getHookFunction(this.middleware.beforeModel)(state, runtime)
  }
}
export { LegacyBeforeModelNode }
