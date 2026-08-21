import type { LauncherCommandSearchDefinition } from "../shared/launcher"
import {
  assertNativeExtensionIdentifier,
  MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH
} from "@jingle/extension-cli/identity"

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
  assertNativeExtensionIdentifier(
    metadata.extensionName,
    `Native extension runtime metadata extensionName must be a non-empty string of at most ${MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH} characters`
  )
  const commandNames = new Set<string>()
  for (const command of metadata.commands) {
    assertNativeExtensionIdentifier(
      command.name,
      `Native extension runtime metadata command name must be a non-empty string of at most ${MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH} characters`
    )
    if (commandNames.has(command.name)) {
      throw new Error(
        `Native extension runtime metadata declares duplicate command "${command.name}"`
      )
    }
    commandNames.add(command.name)
  }
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
  assertNativeExtensionIdentifier(
    adapters.extensionName,
    `Native extension runtime search adapters extensionName must be a non-empty string of at most ${MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH} characters`
  )
  for (const command of adapters.commands) {
    assertNativeExtensionIdentifier(
      command.name,
      `Native extension runtime search adapters command name must be a non-empty string of at most ${MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH} characters`
    )
  }
  return adapters
}
