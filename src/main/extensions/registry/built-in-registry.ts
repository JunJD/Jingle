import { resolve } from "node:path"
import { nativeExtensionManifests } from "@extensions/index"
import { nativeExtensionMainDefinitions } from "@extensions/main"
import { nativeExtensionRuntimeMetadataPackages } from "@extensions/runtime-metadata-packages"
import { nativeExtensionRuntimePackages } from "@extensions/runtime-packages"
import { BuiltInExtensionProvider } from "./built-in-provider"
import { createStaticExtensionRegistryService } from "./service"
import type { ExtensionRegistryService } from "./types"

let builtInExtensionRegistryService: ExtensionRegistryService | null = null

export interface BuiltInExtensionRegistryOptions {
  excludeExtensionIds?: readonly string[]
}

export function createBuiltInExtensionRegistryService(
  options: BuiltInExtensionRegistryOptions = {}
) {
  const provider = new BuiltInExtensionProvider({
    assetRoots: [resolve("extensions"), resolve("src/extensions")],
    excludeExtensionIds: options.excludeExtensionIds,
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages
  })

  return createStaticExtensionRegistryService(provider.listPackages())
}

export function getBuiltInExtensionRegistryService(): ExtensionRegistryService {
  builtInExtensionRegistryService ??= createBuiltInExtensionRegistryService()
  return builtInExtensionRegistryService
}
