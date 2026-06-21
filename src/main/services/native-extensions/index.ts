import {
  type InstalledNativeExtensionSettingsSchema,
  type NativeExtensionMainDefinition,
  type NativeExtensionInvokeRequest,
  type NativeExtensionLauncherCatalogProjection,
  type NativeExtensionPackageManifest,
  type NativeExtensionSourceMentionProjection,
  type NativeExtensionService,
  toInstalledNativeExtensionSettingsSchema,
  toLauncherCommandOwnerManifest,
  toNativeExtensionLauncherCatalogProjection,
  toNativeExtensionSourceMentionProjection
} from "@shared/native-extensions"
import { DEFAULT_APP_LOCALE, resolveLocalizedText } from "@shared/i18n"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { getDefaultExtensionRegistryService } from "../../extensions/registry/default-registry"
import { loadExtensionMainDefinition } from "../../extensions/registry/main-loader"
import { resolveNativeExtensionExecutionContext } from "../../native-extensions/execution-context"

const nativeExtensionRegistry = getDefaultExtensionRegistryService()
const supportedNativeExtensionPackages = nativeExtensionRegistry.listEnabledPackages(
  process.platform
)

interface NativeExtensionRuntimeDefinition {
  manifest: (typeof supportedNativeExtensionPackages)[number]["manifest"]
  main: (typeof supportedNativeExtensionPackages)[number]["main"]
}

const nativeExtensionDefinitions: NativeExtensionRuntimeDefinition[] =
  supportedNativeExtensionPackages
    .map((extensionPackage) => ({
      main: extensionPackage.main,
      manifest: extensionPackage.manifest
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

  if (!definition.main || definition.main.kind === "module") {
    if (manifestRpcMethods.length > 0 && !definition.main) {
      throw new Error(
        `Native extension "${definition.manifest.name}" declares RPC methods but has no registered main-side service`
      )
    }

    if (manifestRpcMethods.length > 0 && !definition.manifest.capabilities.includes("rpc")) {
      throw new Error(
        `Native extension "${definition.manifest.name}" declares RPC methods without the "rpc" capability`
      )
    }

    continue
  }

  const service = definition.main.definition.service
  if (!service) {
    if (manifestRpcMethods.length > 0) {
      throw new Error(
        `Native extension "${definition.manifest.name}" declares RPC methods but has no registered main-side service`
      )
    }

    continue
  }

  validateNativeExtensionService(definition.manifest.name, manifestRpcMethods, service)
}

export function listNativeExtensionSettingsSchemas(): InstalledNativeExtensionSettingsSchema[] {
  return nativeExtensionDefinitions.map((definition) =>
    toInstalledNativeExtensionSettingsSchema(definition.manifest)
  )
}

export function listNativeExtensionManifests(
  platform = process.platform
): NativeExtensionPackageManifest[] {
  return nativeExtensionRegistry.listManifests(platform)
}

export function listNativeExtensionLauncherCatalog(
  platform = process.platform
): NativeExtensionLauncherCatalogProjection[] {
  return nativeExtensionRegistry
    .listEnabledPackages(platform)
    .sort((left, right) =>
      resolveLocalizedText(left.manifest.title, DEFAULT_APP_LOCALE).localeCompare(
        resolveLocalizedText(right.manifest.title, DEFAULT_APP_LOCALE)
      )
    )
    .flatMap((extensionPackage) => {
      const projection = toNativeExtensionLauncherCatalogProjection(
        extensionPackage.manifest,
        extensionPackage.runtimeMetadata
      )
      return projection.commands.length > 0 ? [projection] : []
    })
}

export function listNativeExtensionSourceMentions(
  platform = process.platform
): NativeExtensionSourceMentionProjection[] {
  return nativeExtensionRegistry
    .listEnabledPackages(platform)
    .sort((left, right) =>
      resolveLocalizedText(left.manifest.title, DEFAULT_APP_LOCALE).localeCompare(
        resolveLocalizedText(right.manifest.title, DEFAULT_APP_LOCALE)
      )
    )
    .flatMap((extensionPackage) => {
      const sourceMention = toNativeExtensionSourceMentionProjection(extensionPackage.manifest)
      return sourceMention ? [sourceMention] : []
    })
}

export async function listNativeExtensionMainDefinitions(
  platform = process.platform
): Promise<Map<string, NativeExtensionMainDefinition>> {
  const definitions = new Map<string, NativeExtensionMainDefinition>()

  for (const extensionPackage of nativeExtensionRegistry.listEnabledPackages(platform)) {
    if (!extensionPackage.main) {
      continue
    }

    if (extensionPackage.main.kind === "module" && extensionPackage.main.trust !== "trusted") {
      continue
    }

    definitions.set(
      extensionPackage.manifest.name,
      await loadExtensionMainDefinition(extensionPackage.main)
    )
  }

  return definitions
}

export async function invokeNativeExtension(
  request: NativeExtensionInvokeRequest
): Promise<unknown> {
  const definition = nativeExtensionDefinitionMap.get(request.extensionName)
  if (!definition) {
    throw new Error(`Unknown native extension "${request.extensionName}"`)
  }

  if (!definition.main) {
    throw new Error(`Native extension "${request.extensionName}" does not expose RPC methods`)
  }

  const mainDefinition = await loadExtensionMainDefinition(definition.main)
  const service = mainDefinition.service
  if (!service) {
    throw new Error(`Native extension "${request.extensionName}" does not expose RPC methods`)
  }

  validateNativeExtensionService(
    definition.manifest.name,
    definition.manifest.rpcMethods ?? [],
    service
  )

  const context = resolveNativeExtensionExecutionContext({
    extensionName: request.extensionName,
    platform: process.platform
  })

  return service.invoke(request, {
    connection: context.connection,
    extensionPreferences: context.extensionPreferences
  })
}

function validateNativeExtensionService(
  extensionName: string,
  manifestRpcMethods: readonly string[],
  service: NativeExtensionService
): void {
  if (service.extensionName !== extensionName) {
    throw new Error(
      `Native extension service "${service.extensionName}" does not match manifest "${extensionName}"`
    )
  }

  if (manifestRpcMethods.length !== service.methods.length) {
    throw new Error(
      `Native extension "${extensionName}" service method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of service.methods) {
    if (!manifestRpcMethods.includes(methodName)) {
      throw new Error(
        `Native extension "${extensionName}" service method "${methodName}" is missing from its manifest`
      )
    }
  }
}
