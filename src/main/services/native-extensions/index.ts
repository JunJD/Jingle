import {
  type InstalledNativeExtensionSettingsSchema,
  type NativeExtensionInvokeRequest,
  toInstalledNativeExtensionSettingsSchema
} from "../../../shared/native-extensions"
import { nativeExtensions } from "../../../extensions"
import {
  hasLauncherPluginCapability,
  validateLauncherPluginManifest
} from "../../../shared/launcher-plugin"
import { toLauncherPluginManifest } from "../../../shared/native-extensions"
import type { NativeExtensionService } from "./sdk"

const nativeExtensionServiceModules = import.meta.glob("../../../extensions/*/main/service.ts", {
  eager: true
}) as Record<string, { default?: NativeExtensionService }>

interface NativeExtensionRuntimeDefinition {
  manifest: (typeof nativeExtensions)[number]["manifest"]
  service?: NativeExtensionService
}

function getNativeExtensionService(params: {
  extensionName: string
  serviceModulePath?: `./main/${string}`
}): NativeExtensionService | undefined {
  if (!params.serviceModulePath) {
    return undefined
  }

  const modulePath = `../../../extensions/${params.extensionName}/${params.serviceModulePath.slice(2)}`
  const service = nativeExtensionServiceModules[modulePath]?.default

  if (!service) {
    throw new Error(
      `Native extension "${params.extensionName}" service module "${params.serviceModulePath}" does not export a default service`
    )
  }

  return service
}

const nativeExtensionDefinitions: NativeExtensionRuntimeDefinition[] = nativeExtensions
  .map((extension) => ({
    manifest: extension.manifest,
    service: getNativeExtensionService({
      extensionName: extension.manifest.name,
      serviceModulePath: extension.serviceModulePath
    })
  }))
  .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title))

const nativeExtensionDefinitionMap = new Map(
  nativeExtensionDefinitions.map((definition) => [definition.manifest.name, definition] as const)
)

for (const definition of nativeExtensionDefinitions) {
  const launcherManifest = toLauncherPluginManifest(definition.manifest)
  validateLauncherPluginManifest(launcherManifest)

  if (!definition.service) {
    continue
  }

  if (definition.service.extensionName !== definition.manifest.name) {
    throw new Error(
      `Native extension service "${definition.service.extensionName}" does not match manifest "${definition.manifest.name}"`
    )
  }

  if (!hasLauncherPluginCapability(launcherManifest, "rpc")) {
    throw new Error(
      `Native extension "${definition.manifest.name}" exposes a main-side service without the "rpc" capability`
    )
  }

  const manifestRpcMethods = launcherManifest.rpcMethods ?? []
  if (manifestRpcMethods.length !== definition.service.methods.length) {
    throw new Error(
      `Native extension "${definition.manifest.name}" service method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of definition.service.methods) {
    if (!manifestRpcMethods.includes(methodName)) {
      throw new Error(
        `Native extension "${definition.manifest.name}" service method "${methodName}" is missing from its manifest`
      )
    }
  }
}

export function listNativeExtensionSettingsSchemas(): InstalledNativeExtensionSettingsSchema[] {
  return nativeExtensionDefinitions.map((definition) =>
    toInstalledNativeExtensionSettingsSchema(definition.manifest)
  )
}

export async function invokeNativeExtension(request: NativeExtensionInvokeRequest): Promise<unknown> {
  const definition = nativeExtensionDefinitionMap.get(request.extensionName)
  if (!definition) {
    throw new Error(`Unknown native extension "${request.extensionName}"`)
  }

  if (!definition.service) {
    throw new Error(`Native extension "${request.extensionName}" does not expose RPC methods`)
  }

  return definition.service.invoke(request)
}
