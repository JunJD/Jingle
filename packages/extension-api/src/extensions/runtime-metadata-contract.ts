import type { LauncherCommandSearchDefinition } from "../shared/launcher"

export interface NativeExtensionRuntimeCommandArgumentHint {
  aliases?: string[]
  name: string
  placeholder?: string
}

export interface NativeExtensionRuntimeCommandSearchMetadata {
  aliases?: string[]
  argumentHints?: NativeExtensionRuntimeCommandArgumentHint[]
  keywords?: string[]
  placeholder?: string
}

export interface NativeExtensionRuntimeCommandMetadata {
  name: string
  search?: NativeExtensionRuntimeCommandSearchMetadata
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

export interface NativeExtensionRuntimeCommandSearchAdapter {
  name: string
  search?: LauncherCommandSearchDefinition
}

export interface NativeExtensionRuntimePackageSearchAdapters {
  commands: NativeExtensionRuntimeCommandSearchAdapter[]
  extensionName: string
}

export function defineNativeExtensionRuntimeSearchAdapters(
  adapters: NativeExtensionRuntimePackageSearchAdapters
): NativeExtensionRuntimePackageSearchAdapters {
  return adapters
}
