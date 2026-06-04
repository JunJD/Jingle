import {
  type InstalledNativeExtensionSettingsSchema,
  type NativeExtensionInvokeRequest,
  type NativeExtensionService,
  toInstalledNativeExtensionSettingsSchema,
  toLauncherCommandOwnerManifest
} from "@shared/native-extensions"
import { DEFAULT_APP_LOCALE, resolveLocalizedText } from "@shared/i18n"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { listUserVisibleNativeExtensionManifests } from "@extensions/index"
import { nativeExtensionMainDefinitions } from "@extensions/main"
import { resolveNativeExtensionExecutionContext } from "../../native-extensions/connection-resolver"

const supportedNativeExtensionManifests = listUserVisibleNativeExtensionManifests(process.platform)

interface NativeExtensionRuntimeDefinition {
  manifest: (typeof supportedNativeExtensionManifests)[number]
  service?: NativeExtensionService
}

const nativeExtensionDefinitions: NativeExtensionRuntimeDefinition[] =
  supportedNativeExtensionManifests
    .map((manifest) => ({
      manifest,
      service: nativeExtensionMainDefinitions.get(manifest.name)?.service
    }))
    .sort((left, right) =>
      resolveLocalizedText(left.manifest.title, DEFAULT_APP_LOCALE).localeCompare(
        resolveLocalizedText(right.manifest.title, DEFAULT_APP_LOCALE)
      )
    )

const nativeExtensionDefinitionMap = new Map(
  nativeExtensionDefinitions.map((definition) => [definition.manifest.name, definition] as const)
)

for (const definition of nativeExtensionDefinitions) {
  const hasLauncherCommands = definition.manifest.commands.some(
    (command) => command.mode === "view" || command.mode === "no-view"
  )
  const launcherManifest = hasLauncherCommands
    ? toLauncherCommandOwnerManifest(definition.manifest)
    : null
  if (launcherManifest) {
    validateLauncherCommandOwnerManifest(launcherManifest)
  }
  const manifestRpcMethods = definition.manifest.rpcMethods ?? []

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

  if (!definition.manifest.capabilities.includes("rpc")) {
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

  const context = resolveNativeExtensionExecutionContext({
    extensionName: request.extensionName,
    platform: process.platform
  })

  return definition.service.invoke(request, {
    connection: context.connection,
    extensionPreferences: context.extensionPreferences
  })
}
