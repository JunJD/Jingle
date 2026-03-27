import type { BuiltPluginInvokeRequest } from "../../../shared/built-plugins/sdk"
import {
  hasLauncherPluginCapability,
  type LauncherPluginManifest,
  validateLauncherPluginManifest
} from "../../../shared/launcher-plugin"
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
  validateLauncherPluginManifest(definition.manifest)

  if (definition.service && definition.service.pluginId !== definition.manifest.id) {
    throw new Error(
      `Built plugin service "${definition.service.pluginId}" does not match manifest "${definition.manifest.id}"`
    )
  }

  const manifestRpcMethods = definition.manifest.rpcMethods ?? []

  if (!definition.service) {
    if (manifestRpcMethods.length > 0) {
      throw new Error(
        `Built plugin "${definition.manifest.id}" declares RPC methods but has no main-side service`
      )
    }

    continue
  }

  if (!hasLauncherPluginCapability(definition.manifest, "rpc")) {
    throw new Error(
      `Built plugin "${definition.manifest.id}" exposes a main-side service without the "rpc" capability`
    )
  }

  if (manifestRpcMethods.length !== definition.service.methods.length) {
    throw new Error(
      `Built plugin "${definition.manifest.id}" service method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of definition.service.methods) {
    if (!manifestRpcMethods.includes(methodName)) {
      throw new Error(
        `Built plugin "${definition.manifest.id}" service method "${methodName}" is missing from its manifest`
      )
    }
  }
}

const builtPluginDefinitionMap = new Map(
  builtPluginDefinitions.map((definition) => [definition.manifest.id, definition] as const)
)

export function listBuiltPluginManifests(): LauncherPluginManifest[] {
  return builtPluginDefinitions.map((definition) => definition.manifest)
}

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
