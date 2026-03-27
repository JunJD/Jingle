import type { BuiltPluginInvokeRequest } from "../../../shared/built-plugins/sdk"
import type { LauncherPluginManifest } from "../../../shared/launcher-plugin"
import { aiLauncherPluginManifest } from "../../../plugins/ai/manifest"
import { translateLauncherPluginManifest } from "../../../plugins/translate/manifest"
import { translateBuiltPluginService } from "./translate"
import type { BuiltPluginService } from "./sdk"

interface BuiltPluginRuntimeDefinition {
  manifest: LauncherPluginManifest
  service?: BuiltPluginService
}

const builtPluginDefinitions: BuiltPluginRuntimeDefinition[] = [
  { manifest: aiLauncherPluginManifest },
  {
    manifest: translateLauncherPluginManifest,
    service: translateBuiltPluginService
  }
]

for (const definition of builtPluginDefinitions) {
  if (definition.service && definition.service.pluginId !== definition.manifest.id) {
    throw new Error(
      `Built plugin service "${definition.service.pluginId}" does not match manifest "${definition.manifest.id}"`
    )
  }
}

const builtPluginDefinitionMap = new Map(
  builtPluginDefinitions.map((definition) => [definition.manifest.id, definition] as const)
)

export async function invokeBuiltPlugin(request: BuiltPluginInvokeRequest): Promise<unknown> {
  const definition = builtPluginDefinitionMap.get(request.pluginId)
  if (!definition) {
    throw new Error(`Unknown built plugin "${request.pluginId}"`)
  }

  if (!definition.service) {
    throw new Error(`Built plugin "${request.pluginId}" does not expose main-side RPC methods`)
  }

  return definition.service.invoke(request)
}
