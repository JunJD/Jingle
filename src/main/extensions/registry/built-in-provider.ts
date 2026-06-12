import { existsSync } from "node:fs"
import { join } from "node:path"
import type {
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import type {
  NativeExtensionRuntimePackage,
  NativeExtensionRuntimePackageMetadata
} from "@openwork/extension-api"
import type { ExtensionPackageDescriptor, ExtensionProvider } from "./types"

export interface BuiltInExtensionProviderInput {
  assetRoots: string[]
  excludeExtensionIds?: readonly string[]
  mainDefinitions: Map<string, NativeExtensionMainDefinition>
  manifests: NativeExtensionPackageManifest[]
  runtimeMetadataPackages: NativeExtensionRuntimePackageMetadata[]
  runtimePackages: NativeExtensionRuntimePackage[]
}

export class BuiltInExtensionProvider implements ExtensionProvider {
  constructor(private readonly input: BuiltInExtensionProviderInput) {}

  listPackages(): ExtensionPackageDescriptor[] {
    const excludedExtensionIds = new Set(this.input.excludeExtensionIds ?? [])
    const mainDefinitions = this.input.mainDefinitions
    const runtimePackagesByExtensionName = new Map(
      this.input.runtimePackages.map((runtimePackage) => [
        runtimePackage.extensionName,
        runtimePackage
      ])
    )
    const runtimeMetadataByExtensionName = new Map(
      this.input.runtimeMetadataPackages.map((runtimeMetadata) => [
        runtimeMetadata.extensionName,
        runtimeMetadata
      ])
    )

    return this.input.manifests.flatMap((manifest) => {
      if (excludedExtensionIds.has(manifest.name)) {
        return []
      }

      const version = "built-in"
      return [
        {
          assetsDir: resolveBuiltInAssetsDir(this.input.assetRoots, manifest.name),
          enabled: true,
          errors: [],
          id: manifest.name,
          main: {
            definition: mainDefinitions.get(manifest.name) ?? {},
            extensionName: manifest.name,
            kind: "in-memory",
            trust: "trusted",
            version
          },
          manifest,
          rootDir: resolveBuiltInPackageRoot(this.input.assetRoots, manifest.name),
          runtime: toRuntimeRef({
            runtimePackage: runtimePackagesByExtensionName.get(manifest.name),
            version
          }),
          runtimeMetadata: runtimeMetadataByExtensionName.get(manifest.name) ?? null,
          source: "built-in",
          status: "loaded",
          trust: "trusted",
          version
        }
      ]
    })
  }
}

function resolveBuiltInPackageRoot(assetRoots: string[], extensionName: string): string {
  const matchingRoot = assetRoots.find((assetRoot) => existsSync(join(assetRoot, extensionName)))
  return join(matchingRoot ?? assetRoots[0] ?? "", extensionName)
}

function resolveBuiltInAssetsDir(assetRoots: string[], extensionName: string): string {
  return join(resolveBuiltInPackageRoot(assetRoots, extensionName), "assets")
}

function toRuntimeRef(input: {
  runtimePackage: NativeExtensionRuntimePackage | undefined
  version: string
}) {
  if (!input.runtimePackage) {
    return null
  }

  return {
    extensionName: input.runtimePackage.extensionName,
    kind: "in-memory" as const,
    runtimePackage: input.runtimePackage,
    version: input.version
  }
}
