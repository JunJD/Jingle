import { existsSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import type {
  ExtensionPackageDescriptor,
  ExtensionProvider,
  ExtensionRegistryService,
  LoadedExtensionPackageDescriptor
} from "./types"

export async function createExtensionRegistryService(
  providers: ExtensionProvider[]
): Promise<ExtensionRegistryService> {
  const packages = (await Promise.all(providers.map((provider) => provider.listPackages()))).flat()
  return createStaticExtensionRegistryService(packages)
}

export function createStaticExtensionRegistryService(
  packages: ExtensionPackageDescriptor[]
): ExtensionRegistryService {
  return new StaticExtensionRegistryService(packages)
}

class StaticExtensionRegistryService implements ExtensionRegistryService {
  private readonly packagesById: Map<string, ExtensionPackageDescriptor>

  constructor(private readonly packages: ExtensionPackageDescriptor[]) {
    this.packagesById = new Map(
      packages.map((extensionPackage) => [extensionPackage.id, extensionPackage])
    )
    if (this.packagesById.size !== packages.length) {
      throw new Error("Extension registry declares duplicate extension ids")
    }
  }

  listPackages(): ExtensionPackageDescriptor[] {
    return [...this.packages]
  }

  listLoadedPackages(): LoadedExtensionPackageDescriptor[] {
    return this.packages.filter(isLoadedPackage)
  }

  listEnabledPackages(platform: string): LoadedExtensionPackageDescriptor[] {
    return this.listLoadedPackages().filter(
      (extensionPackage) =>
        extensionPackage.enabled &&
        supportsNativeExtensionPlatform(extensionPackage.manifest, platform)
    )
  }

  listManifests(platform: string) {
    return this.listEnabledPackages(platform).map((extensionPackage) => extensionPackage.manifest)
  }

  getPackage(extensionName: string): ExtensionPackageDescriptor | null {
    return this.packagesById.get(extensionName) ?? null
  }

  getLoadedPackage(extensionName: string): LoadedExtensionPackageDescriptor | null {
    const extensionPackage = this.getPackage(extensionName)
    return extensionPackage && isLoadedPackage(extensionPackage) ? extensionPackage : null
  }

  getRuntimePackageRef(extensionName: string) {
    return this.getLoadedPackage(extensionName)?.runtime ?? null
  }

  getMainRef(extensionName: string) {
    return this.getLoadedPackage(extensionName)?.main ?? null
  }

  resolveAsset(extensionName: string, assetPath: string): string {
    const extensionPackage = this.getLoadedPackage(extensionName)
    if (!extensionPackage) {
      throw new Error(`Unknown extension "${extensionName}"`)
    }

    const absolutePath = resolve(extensionPackage.rootDir, assetPath)
    const assetsRoot = resolve(extensionPackage.assetsDir)
    const relativePath = relative(assetsRoot, absolutePath)
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Extension "${extensionName}" asset path escapes its assets directory`)
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Extension "${extensionName}" asset does not exist: ${assetPath}`)
    }
    return absolutePath
  }
}

function isLoadedPackage(
  extensionPackage: ExtensionPackageDescriptor
): extensionPackage is LoadedExtensionPackageDescriptor {
  return extensionPackage.status === "loaded"
}
