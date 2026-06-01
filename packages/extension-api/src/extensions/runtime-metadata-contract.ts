import type { LauncherCommandSearchDefinition } from "../shared/launcher"

export interface NativeExtensionRuntimeCommandMetadata {
  name: string
  search?: LauncherCommandSearchDefinition
}

export interface NativeExtensionRuntimePackageMetadata {
  commands: NativeExtensionRuntimeCommandMetadata[]
  extensionName: string
}

export function defineNativeExtensionRuntimeMetadata(
  metadata: NativeExtensionRuntimePackageMetadata
): NativeExtensionRuntimePackageMetadata {
  return metadata
}
