import type { BuiltPluginInvokeRequest } from "../../../shared/built-plugins/sdk"
import type { BuiltPluginService } from "./sdk"

const builtPluginServices: BuiltPluginService[] = []

const builtPluginServiceMap = new Map(
  builtPluginServices.map((service) => [service.pluginId, service])
)

export async function invokeBuiltPlugin(request: BuiltPluginInvokeRequest): Promise<unknown> {
  const service = builtPluginServiceMap.get(request.pluginId)
  if (!service) {
    throw new Error(`Unknown built plugin "${request.pluginId}"`)
  }

  return service.invoke(request)
}
