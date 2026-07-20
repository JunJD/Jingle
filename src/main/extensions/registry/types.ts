import type {
  NativeExtensionInstallDiagnosticCode,
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import type {
  NativeExtensionRuntimePackage,
  NativeExtensionRuntimePackageMetadata
} from "@jingle/extension-api"
import type { InstalledExtensionRuntimeArtifactRevision } from "./descriptor-schema"

export type ExtensionPackageSource = "built-in" | "installed"
export type ExtensionPackageTrustLevel = "trusted" | "untrusted"

export type ExtensionPackageErrorCode = NativeExtensionInstallDiagnosticCode

export interface ExtensionPackageError {
  code: ExtensionPackageErrorCode
  message: string
}

export interface ExtensionRuntimePackageRef {
  extensionName: string
  kind: "in-memory"
  runtimePackage: NativeExtensionRuntimePackage
  version: string
}

export type ExtensionRuntimeArtifactRevision =
  | {
      kind: "available"
      revision: InstalledExtensionRuntimeArtifactRevision
    }
  | {
      kind: "unavailable"
      reason: "legacy-descriptor"
    }

export interface ExtensionRuntimeModuleRef {
  extensionName: string
  kind: "module"
  modulePath: string
  runtimeArtifactRevision: ExtensionRuntimeArtifactRevision
  version: string
}

export type ExtensionRuntimeRef = ExtensionRuntimeModuleRef | ExtensionRuntimePackageRef

export interface ExtensionMainPackageRef {
  definition: NativeExtensionMainDefinition
  extensionName: string
  kind: "in-memory"
  trust: ExtensionPackageTrustLevel
  version: string
}

export interface ExtensionMainModuleRef {
  extensionName: string
  kind: "module"
  modulePath: string
  trust: ExtensionPackageTrustLevel
  version: string
}

export type ExtensionMainRef = ExtensionMainModuleRef | ExtensionMainPackageRef

export interface LoadedExtensionPackageDescriptor {
  assetsDir: string
  enabled: boolean
  errors: []
  id: string
  main: ExtensionMainRef | null
  manifest: NativeExtensionPackageManifest
  rootDir: string
  runtime: ExtensionRuntimeRef | null
  runtimeMetadata: NativeExtensionRuntimePackageMetadata | null
  source: ExtensionPackageSource
  status: "loaded"
  trust: ExtensionPackageTrustLevel
  version: string
}

export interface FailedExtensionPackageDescriptor {
  assetsDir: string | null
  enabled: false
  errors: ExtensionPackageError[]
  id: string
  rootDir: string
  source: ExtensionPackageSource
  status: "error"
  trust: ExtensionPackageTrustLevel
  version: string | null
}

export type ExtensionPackageDescriptor =
  | FailedExtensionPackageDescriptor
  | LoadedExtensionPackageDescriptor

export interface ExtensionProvider {
  listPackages(): ExtensionPackageDescriptor[] | Promise<ExtensionPackageDescriptor[]>
}

export interface ExtensionRegistryService {
  getLoadedPackage(extensionName: string): LoadedExtensionPackageDescriptor | null
  getMainRef(extensionName: string): ExtensionMainRef | null
  getPackage(extensionName: string): ExtensionPackageDescriptor | null
  getRuntimePackageRef(extensionName: string): ExtensionRuntimeRef | null
  listEnabledPackages(platform: string): LoadedExtensionPackageDescriptor[]
  listFailedInstalledPackages(): FailedExtensionPackageDescriptor[]
  listLoadedPackages(): LoadedExtensionPackageDescriptor[]
  listManifests(platform: string): NativeExtensionPackageManifest[]
  listPackages(): ExtensionPackageDescriptor[]
  resolveAsset(extensionName: string, assetPath: string): string
}
