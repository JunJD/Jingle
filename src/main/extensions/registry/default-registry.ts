import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { nativeExtensionManifests } from "@extensions/index"
import { nativeExtensionMainDefinitions } from "@extensions/main"
import { nativeExtensionRuntimeMetadataPackages } from "@extensions/runtime-metadata-packages"
import { nativeExtensionRuntimePackages } from "@extensions/runtime-packages"
import { getJingleHomeDir } from "../../storage"
import { BuiltInExtensionProvider } from "./built-in-provider"
import { InstalledExtensionProvider } from "./installed-provider"
import { createStaticExtensionRegistryService } from "./service"
import type { ExtensionPackageDescriptor, ExtensionRegistryService } from "./types"

let defaultExtensionRegistryService: ExtensionRegistryService | null = null

export function getBundledInstalledExtensionsRoot(): string {
  return process.env.ELECTRON_RENDERER_URL
    ? resolve(".jingle-build/installed-extensions")
    : join(__dirname, "../resources/installed-extensions")
}

export function getUserInstalledExtensionsRoot(): string {
  return join(getJingleHomeDir(), "extensions")
}

export function createDefaultExtensionRegistryService(): ExtensionRegistryService {
  const installedOwnerPackages = selectInstalledOwnerPackages(listInstalledExtensionPackages())
  const installedPackageIds = new Set<string>()
  for (const extensionPackage of installedOwnerPackages) {
    if (extensionPackage.status === "loaded" && extensionPackage.enabled) {
      installedPackageIds.add(extensionPackage.id)
    }
  }
  const builtInProvider = new BuiltInExtensionProvider({
    assetRoots: [
      resolve("extensions"),
      resolve("src/extensions"),
      join(__dirname, "../resources/extensions")
    ],
    excludeExtensionIds: [...installedPackageIds],
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages
  })
  const builtInPackages = builtInProvider.listPackages()
  const builtInPackageIds = new Set(builtInPackages.map((extensionPackage) => extensionPackage.id))
  const packages: ExtensionPackageDescriptor[] = [
    ...builtInPackages,
    ...installedOwnerPackages.filter(
      (extensionPackage) => !builtInPackageIds.has(extensionPackage.id)
    )
  ]

  return createStaticExtensionRegistryService(packages)
}

function listInstalledExtensionPackages(): ExtensionPackageDescriptor[] {
  const packages: ExtensionPackageDescriptor[] = []
  for (const installedRoot of [
    getBundledInstalledExtensionsRoot(),
    getUserInstalledExtensionsRoot()
  ]) {
    if (existsSync(installedRoot)) {
      packages.push(...new InstalledExtensionProvider(installedRoot).listPackages())
    }
  }

  return packages
}

function selectInstalledOwnerPackages(
  packages: ExtensionPackageDescriptor[]
): ExtensionPackageDescriptor[] {
  const packagesById = new Map<string, ExtensionPackageDescriptor>()
  for (const extensionPackage of packages) {
    const currentPackage = packagesById.get(extensionPackage.id)
    if (
      !currentPackage ||
      shouldReplaceInstalledOwnerPackage(extensionPackage, currentPackage)
    ) {
      packagesById.set(extensionPackage.id, extensionPackage)
    }
  }

  return [...packagesById.values()]
}

function shouldReplaceInstalledOwnerPackage(
  candidate: ExtensionPackageDescriptor,
  current: ExtensionPackageDescriptor
): boolean {
  const candidateRank = getInstalledOwnerRank(candidate)
  const currentRank = getInstalledOwnerRank(current)
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank
  }

  const candidateVersion = candidate.version ?? ""
  const currentVersion = current.version ?? ""
  if (candidateVersion !== currentVersion) {
    return candidateVersion.localeCompare(currentVersion) > 0
  }

  return true
}

function getInstalledOwnerRank(extensionPackage: ExtensionPackageDescriptor): number {
  if (extensionPackage.status === "loaded" && extensionPackage.enabled) {
    return 2
  }

  if (extensionPackage.status === "loaded") {
    return 1
  }

  return 0
}

export function getDefaultExtensionRegistryService(): ExtensionRegistryService {
  defaultExtensionRegistryService ??= createDefaultExtensionRegistryService()
  return defaultExtensionRegistryService
}
