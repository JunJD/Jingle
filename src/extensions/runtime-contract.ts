import type { ComponentType } from "react"
import type { ExtensionRuntimeLaunchContext } from "@shared/extension-runtime-protocol"
import type { ExtensionRuntimeNavigation } from "../extension-runtime/sdk"

export interface NativeExtensionRuntimeNoViewRunContext extends ExtensionRuntimeLaunchContext {
  navigation: ExtensionRuntimeNavigation
}

export interface NativeExtensionRuntimeViewCommandEntry {
  Component: ComponentType
  mode: "view"
}

export interface NativeExtensionRuntimeMenuBarCommandEntry {
  Component: ComponentType
  mode: "menu-bar"
}

export interface NativeExtensionRuntimeNoViewCommandEntry {
  mode: "no-view"
  run: (context: NativeExtensionRuntimeNoViewRunContext) => Promise<void> | void
}

export type NativeExtensionRuntimeCommandEntry =
  | NativeExtensionRuntimeMenuBarCommandEntry
  | NativeExtensionRuntimeNoViewCommandEntry
  | NativeExtensionRuntimeViewCommandEntry

export interface NativeExtensionRuntimePackage {
  commands: Record<string, NativeExtensionRuntimeCommandEntry>
  extensionName: string
}

export interface NativeExtensionRuntimeViewCommandDefinition
  extends NativeExtensionRuntimeViewCommandEntry {
  commandName: string
  extensionName: string
}

export interface NativeExtensionRuntimeMenuBarCommandDefinition
  extends NativeExtensionRuntimeMenuBarCommandEntry {
  commandName: string
  extensionName: string
}

export interface NativeExtensionRuntimeNoViewCommandDefinition
  extends NativeExtensionRuntimeNoViewCommandEntry {
  commandName: string
  extensionName: string
}

export type NativeExtensionRuntimeCommandDefinition =
  | NativeExtensionRuntimeMenuBarCommandDefinition
  | NativeExtensionRuntimeNoViewCommandDefinition
  | NativeExtensionRuntimeViewCommandDefinition

export function defineNativeExtensionRuntime(
  runtimePackage: NativeExtensionRuntimePackage
): NativeExtensionRuntimePackage {
  return runtimePackage
}
