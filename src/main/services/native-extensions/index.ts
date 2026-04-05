import {
  type InstalledNativeExtensionSettingsSchema,
  type NativeExtensionInvokeRequest,
  type NativeExtensionService,
  toInstalledNativeExtensionSettingsSchema,
  toLauncherCommandOwnerManifest
} from "../../../shared/native-extensions"
import {
  hasLauncherCommandOwnerCapability,
  validateLauncherCommandOwnerManifest
} from "../../../shared/launcher-command-owner"
import { nativeExtensionManifests } from "../../../extensions"
import { nativeExtensionMainDefinitions } from "../../../extensions/main"

interface NativeExtensionRuntimeDefinition {
  manifest: (typeof nativeExtensionManifests)[number]
  service?: NativeExtensionService
}

const nativeExtensionDefinitions: NativeExtensionRuntimeDefinition[] = nativeExtensionManifests
  .map((manifest) => ({
    manifest,
    service: nativeExtensionMainDefinitions.get(manifest.name)?.service
  }))
  .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title))

const nativeExtensionDefinitionMap = new Map(
  nativeExtensionDefinitions.map((definition) => [definition.manifest.name, definition] as const)
)

for (const definition of nativeExtensionDefinitions) {
  const launcherManifest = toLauncherCommandOwnerManifest(definition.manifest)
  validateLauncherCommandOwnerManifest(launcherManifest)
  const manifestRpcMethods = launcherManifest.rpcMethods ?? []

  if (!definition.service) {
    if (manifestRpcMethods.length > 0) {
      throw new Error(
        `Native extension "${definition.manifest.name}" declares RPC methods but has no registered main-side service`
      )
    }

    continue
  }

  if (definition.service.extensionName !== definition.manifest.name) {
    throw new Error(
      `Native extension service "${definition.service.extensionName}" does not match manifest "${definition.manifest.name}"`
    )
  }

  if (!hasLauncherCommandOwnerCapability(launcherManifest, "rpc")) {
    throw new Error(
      `Native extension "${definition.manifest.name}" exposes a main-side service without the "rpc" capability`
    )
  }

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

export async function invokeNativeExtension(
  request: NativeExtensionInvokeRequest
): Promise<unknown> {
  const definition = nativeExtensionDefinitionMap.get(request.extensionName)
  if (!definition) {
    throw new Error(`Unknown native extension "${request.extensionName}"`)
  }

  if (!definition.service) {
    throw new Error(`Native extension "${request.extensionName}" does not expose RPC methods`)
  }

  return definition.service.invoke(request)
}
