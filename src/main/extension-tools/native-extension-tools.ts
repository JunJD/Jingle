import type {
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import { ExtensionToolRegistry } from "./registry"

export function createNativeExtensionToolRegistry(input: {
  definitions: Map<string, NativeExtensionMainDefinition>
  manifests: NativeExtensionPackageManifest[]
}): ExtensionToolRegistry {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: input.manifests.map((manifest) => manifest.name)
  })

  for (const manifest of input.manifests) {
    registry.registerExtensionTools(
      manifest.name,
      input.definitions.get(manifest.name)?.tools ?? []
    )
  }

  return registry
}
